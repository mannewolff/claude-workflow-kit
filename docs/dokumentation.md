# Dokumentation: claude-workflow-kit

Eine dünne Werkzeugschicht, die einen 9-Schritt-Kernprozess für KI-gestützte Entwicklung in Claude Code ausführbar macht. Das Kit automatisiert die KI-Schritte und lässt die drei menschlichen Verantwortungsschwellen bewusst stehen.

## Konzept

Das Kit ist keine Plattform und kein Agent. Es ist eine Bibliothek aus dreizehn Skills, eine projektlokale Config und ein Installer.

Die Skills sind projekt-unabhängig geschrieben. Alles Projekt-Spezifische (Build-Kommandos, Branch-Namen, Review-Modell) kommt aus der Config-Datei. Ein Update an einem Skill gilt damit in allen Projekten, in denen du das Kit nutzt. Du musst nicht in jedem Repo etwas anpassen, wenn sich der Prozess weiterentwickelt.

Der Kernprozess hat neun Schritte. Schritt 1 ist deine Anforderung; die KI übernimmt die Schritte 2, 3, 5, 6 und 7. Die drei menschlichen Stop-Punkte sind Schritt 4 (GO), Schritt 8 (Push) und Schritt 9 (Merge); zwischen Push und Merge prüfst du den Test-Server. Sechs weitere Skills stehen außerhalb der Nummerierung und strukturieren den Arbeitsrhythmus: /kontext, /implement-test und /implement-done, /implement-next, /retro und /document.

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

**Ein Projekt-Board, falls du GitHub oder GitLab als Issue-Tracker nutzt.** Das Board braucht diese fünf Spalten: Backlog, Ready, In progress, In review, Done. Bei GitHub sind das Projekt-Board-Spalten (GitHub Projects), bei GitLab werden sie durch Labels abgebildet. Im lokalen Modus gibt es kein Board — der Adapter schreibt und liest YAML-Frontmatter-Dateien direkt.

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

Der Installer kopiert die fünfzehn Skills, schreibt eine `.claude/workflow.config.json` mit deinen Antworten, legt eine `CLAUDE-workflow.md` mit der Prozessbeschreibung sowie die beiden Gate-Register `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md` ab und schreibt den Board-Adapter in `.claude/kit/board.mjs`. Bei GitLab fragt er zusätzlich, ob er die fünf Labels automatisch anlegen soll. Kein Hintergrundprozess, kein Service, keine Registry-Einträge.

Die frühere lokale Kanban-GUI (`board-ui.mjs`) ist eingestellt.

Nach der Installation startest du Claude Code neu. Die Skills erscheinen dann unter `/help`.

### Was der Installer schreibt — und warum es nicht ins Repo gehoert

Alles, was der Installer unter `.claude/` ablegt, ist **Generat**: die Skills, `CLAUDE-workflow.md` und die beiden Gate-Register. Beim naechsten Lauf schreibt er es neu. Eine dieser Dateien im Repo zu versionieren, hiesse einen zweiten Stand zu fuehren, der bis zum naechsten Install driftet — und es naehme jedem die Entscheidung ab, **ob** er ueberhaupt neu installiert.

Dieses Repo haelt es deshalb selbst so, und fuer dein Projekt ist es die empfohlene Aufteilung:

```gitignore
.claude/*
!.claude/workflow.config.json
```

Die erste Zeile muss `.claude/*` lauten, nicht `.claude`: Git wertet innerhalb eines gesperrten Verzeichnisses kein `!`-Muster mehr aus — die Ausnahme fiele still mit heraus.

`workflow.config.json` ist die begruendete Ausnahme. Der Installer **ueberschreibt sie nicht, er mergt**: Basis sind die Vorgabewerte, darueber die vorhandene Datei, zuoberst die abgefragten Antworten. Nicht abgefragte Felder wie `buildChecks` oder `issueReview` bleiben erhalten. Sie ist Team-Einstellung, kein Generat — und gehoert deshalb versioniert.

### Welchen Stand hat meine Installation?

Der Board-Adapter und der Nacht-Runner sind Kopien — sie liegen nach der Installation in deinem Projekt und altern dort, während das Kit weiterentwickelt wird. Beide sagen dir auf Nachfrage, aus welchem Kit-Stand sie stammen:

```bash
node .claude/kit/board.mjs --version
node .claude/kit/night.mjs --version
```

```
board.mjs (claude-workflow-kit v1.22.0)
```

Vergleiche das mit der aktuellen Kit-Version (`node install.mjs --version`, oder die Versionsangabe auf der Download-Seite). Liegt deine Kopie zurück, spielst du einfach den Installer erneut ein — er überschreibt die Kit-Dateien und lässt deine `workflow.config.json` bis auf die abgefragten Felder unangetastet.

Die Versionsnummer ist bewusst dieselbe wie die des Kits, keine eigene Zählung pro Datei: Eine Kopie mit `v1.22.0` ist exakt der Stand, den Kit 1.22.0 ausgeliefert hat. Laufen die beiden Dateien auseinander — etwa weil nur eine von beiden ersetzt wurde —, warnt der Nacht-Runner beim Start und läuft trotzdem weiter.

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

`local.issuesDir` gibt das Verzeichnis an, in dem lokale Issues als Markdown-Dateien liegen (`issues/0001.md`, `issues/0002.md`, …). `github.projectNumber` ist die Projekt-Nummer des GitHub Projects Board — nur für `issueTracker: github` relevant. Fehlt sie, versucht der Adapter automatisch das einzige vorhandene GitHub Project des Owners zu erkennen (mit Hinweis auf stderr, kein automatischer Config-Schreibzugriff); gibt es kein oder mehrere Projects, bricht er mit einer Fehlermeldung ab, die zur Ergänzung des Felds auffordert.

Bei `issueTracker: github` legt der Adapter beim ersten Zugriff eine Cache-Datei `.claude/board-meta-cache.json` mit den Project-Metadaten (Project-ID, Status-Feld- und Options-IDs) an. Sie erspart jedem weiteren `board.mjs`-Aufruf zwei GraphQL-Abfragen und schont so das GitHub-Kontingent. Die Datei ist maschinenlokal und gehört nicht ins Repository — der Installer ignoriert `.claude/` ohnehin komplett; committest du `.claude/` selbst, nimm `.claude/board-meta-cache.json` in die `.gitignore` auf. Löschst du sie, wird sie beim nächsten Aufruf neu aufgebaut; veraltete IDs heilt der Adapter automatisch.

`columns` steuert die Spaltennamen auf dem Board. Die fünf Schlüssel (`backlog`, `ready`, `in_progress`, `in_review`, `done`) sind fix — sie stehen im Frontmatter der Issue-Dateien und sind die internen Status-Werte. Die Werte sind die angezeigten Bezeichnungen und frei wählbar. Bei GitHub entsprechen die Werte den Spaltennamen im Project Board, bei GitLab den Label-Namen. Ohne `columns` in der Config gelten die Defaults: Backlog, Ready, In progress, In review, Done.

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

## Die fünfzehn Skills und der 9-Schritt-Kernprozess

Der Prozess hat **neun** Schritte, davon sieben mit Skill. Die übrigen acht Skills sind Werkzeuge daneben: hilfreich, oft benutzt — aber ohne sie läuft der Prozess auch.

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

### Werkzeuge neben dem Prozess

Sie tragen keine Nummer, weil eine Nummer eine Reihenfolge und eine Pflicht behaupten würde, die es nicht gibt. Die neun Schritte sind der Prozess aus dem Whitepaper; was hier steht, ist Werkzeug des Kits.

**Ergänzen den Prozess**

| Skill | Wofür |
|-------|-------|
| `/kontext` | Session-Start: Vault laden, Projektstand |
| `/fachplan` | Anforderung als fachliches Issue zum Groomen mit dem PO |
| `/issue-review` | fachliche Anforderung, Plandokument **oder** Arbeitspaket prüfen lassen — ein Kommando, drei Stufen |
| `/retro` | KI-Retrospektive, Memory konsolidieren |
| `/document` | Session-Ende: Tageslog und Projektnotiz |

**Ersetzen Schritt 5 durch eine feinere Gangart**

| Skill | Wofür |
|-------|-------|
| `/implement-next` | genau ein Ready-Issue statt der ganzen Spalte |
| `/implement-test` | nur die roten Tests, Stopp vor der Implementierung |
| `/implement-done` | Implementierung gegen die vorbereiteten roten Tests |

Wer das Kit einführt, kann mit den neun Schritten anfangen und die Werkzeuge später dazunehmen. Umgekehrt gilt: Wer den nächsten nützlichen Skill baut, trägt ihn hier ein — nicht als Zwischennummer.

### /kontext

**Werkzeug neben dem Prozess, Session-Start.**

Der Skill lädt den Kontext, den du brauchst, um sofort arbeitsfähig zu sein, ohne den Chat der letzten Session im Kopf haben zu müssen. Er liest `kontext.config.json` (zuerst global aus `~/.claude/`, dann lokal aus `.claude/`, wobei lokale Werte die globalen überschreiben).

Wenn ein Vault konfiguriert ist, lädt er die `always`-Dateien daraus (Profil, Arbeitsregeln), erkennt die Projektnotiz automatisch anhand des Repo-Namens und liest zusätzliche `projectDocs`. Ohne Vault holt er die offenen Issues per CLI und liest `projectDocs` aus dem Repo. Die Ausgabe ist ein kurzer Lageüberblick: offene Issues, letzte Entscheidungen, was als nächstes ansteht.

### /fachplan

**Werkzeug neben dem Prozess, vor Schritt 2 — nur für Projekte mit Product Owner ([PO-Schleife](#po-schleife-fachliche-und-technische-issues)).**

Der Skill überführt eine rohe Anforderung (diktiert, aus einer Mail, aus dem Chat) in genau ein **fachliches Issue**: Titel mit dem Präfix `[Fachlich]`, Body im Story-Format (Ziel, fachliche Akzeptanzkriterien, Nicht-Ziele, offene Fragen an den PO) — strikt technikfrei, in PO-Sprache. Das Issue ist das Übergabe-Artefakt an den PO und wird direkt am Board gegroomt — die PO-Antworten und Ergänzungen gehören in den **Body**, nicht in Kommentare — der Body trägt den verhandelten Stand, Kommentare den Verlauf. (`board.mjs issue get` liefert die Kommentare inzwischen mit, aber eine Anforderung, die man aus einer Diskussion zusammensuchen muss, hat keinen eindeutigen Stand.)

Der Skill erstellt keinen technischen Plan und keine technischen Issues; das kommt nach der PO-Freigabe über `/plan #N`. Wer keinen PO hat, überspringt diesen Schritt und startet wie gewohnt mit `/plan`.

### /plan

**Schritt 2, nach der Anforderung (Schritt 1), vor der Implementierung.**

Du gibst die Anforderung, der Skill erzeugt einen Plan. Der Plan benennt Ziel und Nutzerwirkung, betroffene Bereiche und Dateien, architektonische Entscheidungen mit Begründung, offene Fragen und die geplante Verifizierung. Anschließend stellt er den Plan zur Diskussion.

Der Skill implementiert nichts. **Technische Issues stellt er nicht an** — die entstehen erst in `/issues`, nach deinem GO. Er wartet auf dein Feedback. Der Plan ist Diskussionsgrundlage, kein Auftrag und noch keine Freigabe.

Eine Ausnahme gibt es: Sobald du den Plan freigibst, legt der Skill bei Bahn 2 das Plandokument selbst als Issue mit dem Titel-Präfix `[Plan]` an — mit dem Plan als Body, `Plan-Modell:` im Kopf und, falls der Plan aus `/plan #N` gegen ein fachliches Issue entstand, `Fachliche Quelle: Issue #N`. Es hält den freigegebenen Stand fest, statt ihn umzusetzen: Was zwischen Anforderung und Arbeitspaketen entschieden wurde — Architektur, Schnitt, Abwägungen — stünde sonst nirgends. `[Plan]`-Issues werden nie implementiert (siehe das Gate weiter unten); zerlegt werden sie per `/issues #N`. Bei Bahn 1 entsteht kein Plandokument.

### /issues

**Schritt 3, nach der Plan-Freigabe.**

Aus dem freigegebenen Plan werden ein oder mehrere Issues. Jedes Issue ist kleinteilig genug, um eigenständig getestet zu werden, und enthält vier Abschnitte: Kontext (warum), Aufgabe (was genau), Akzeptanzkriterium (wie prüfbar) und Abhängigkeiten (was muss vorher fertig sein).

Ab diesem Punkt ist das Issue die Quelle der Wahrheit (nicht der Chat, nicht dein Gedächtnis, nicht der Plan-Text). Die Issues landen im Backlog.

Zum Abschluss listet der Skill die angelegten Issues und gibt pro Issue eine Modell-Empfehlung (schnelleres Standard-Modell für mechanische Aufgaben, stärkstes verfügbares Modell für Architektur- oder Sicherheitslogik, jeweils mit einem Satz Begründung). So entscheidest du vor dem GO, mit welchem Modell du jedes Issue umsetzt, ohne den Plan-Kontext noch einmal zu lesen.

### Schritt 4: GO (menschlich)

Du ziehst die Issues, die du im aktuellen Batch umsetzen willst, am Board nach Ready. Das ist deine Entscheidung: wie viel Arbeit du freigibst und was in diesen Durchlauf kommt. Die KI zieht nie eigenmächtig Issues nach Ready.

### /implement-ready

**Schritt 5, nach dem GO.**

Der Skill liest die Ready-Spalte, sortiert nach Issue-Nummer und arbeitet sie sequenziell ab. Pro Issue: Board nach In progress bewegen, Issue vollständig lesen, Code und Tests gegen das Issue schreiben (testgetrieben: Tests zuerst, rot, dann implementieren bis grün), lokal committen, Board nach In review bewegen. Dann das nächste Issue. Ist Ready leer, meldet der Skill Vollzug.

Zwei feste Grenzen: Der Skill pusht nie. Er zieht keine Backlog-Issues eigenmächtig nach Ready.

### /implement-test und /implement-done

**Granularer Einstieg zu Schritt 5, für Einsteiger.**

`/implement-ready` erledigt Test und Implementierung eines Issues in einem Rutsch. Wer den Rot-Grün-Übergang bewusst sehen will, nutzt stattdessen zwei Skills nacheinander: `/implement-test` nimmt das nächste Ready-Issue, bewegt es nach In progress und schreibt ausschließlich die Tests dagegen — kein Produktionscode, kein Commit. Läuft bereits ein Issue in In progress, stoppt der Skill und verweist auf `/implement-done`.

`/implement-done` findet das laufende Issue über die In-progress-Spalte, implementiert gegen die vorbereiteten Tests, bis sie grün sind, und committet Tests und Implementierung gemeinsam — Format und Stop-Punkte identisch zu `/implement-ready`.

### /implement-next

**Genau ein Issue — der Baustein des Nachtbetriebs.**

Die Single-Issue-Variante von `/implement-ready`: nimmt genau ein Ready-Issue, setzt es um, committet lokal, verschiebt es mit Abschlussbericht nach In review — und endet. Kein weiteres Issue, auch wenn Ready noch gefüllt ist. Bei leerem Ready meldet der Skill das und endet ohne Fehler.

Welches Issue dran ist, entscheidet das Argument. `/implement-next` ohne Argument nimmt das oberste Ready-Issue (Board-Reihenfolge). `/implement-next #N` ist ein **verbindlicher Auftrag**: Der Skill arbeitet ausschließlich dieses Issue und weicht nie auf ein anderes aus — liegt `#N` nicht mehr in Ready, endet der Lauf ergebnislos mit einer klaren Meldung. So bleibt die Auswahl an genau einer Stelle: Der Auftraggeber hat bereits nach Routing-Label, Abhängigkeiten und Board-Reihenfolge gefiltert und misst den Erfolg an diesem Issue.

Abgrenzung: `/implement-ready` arbeitet die ganze Spalte in einer Session ab; `/implement-test` und `/implement-done` zerlegen ein Issue in Rot- und Grün-Phase; `/implement-next` macht ein komplettes Issue und stoppt dann. Interaktiv ist das die „mach genau eins"-Variante — seine Hauptrolle spielt er im [Nachtbetrieb](#nachtbetrieb), wo der Nacht-Runner pro Issue eine frische Session mit genau diesem Skill startet.

### /issue-review

**Werkzeug neben dem Prozess, zwischen Schritt 3 und dem GO.**

Der Skill lässt ein Dokument von Modellen prüfen, die es nicht geschrieben haben, und schlägt einen geschärften Body vor. Der Autor eines Issues hat den Kontext im Kopf, aus dem es entstanden ist — was er nicht hingeschrieben hat, fällt ihm beim Lesen nicht auf. Ein fremdes Modell hat nur den Text.

Wie viele prüfen und mit welchen Rollen, entscheidet die Prüfstufe; jede Rolle trägt die Frage „Was kann raus?" — ohne sie wächst das Issue mit jeder Runde, ohne besser zu werden. Die Befunde landen als Board-Kommentar; der Body wird nur nach ausdrücklicher Zustimmung geschrieben. Details im Abschnitt [Issue-Review über mehrere Modelle](#issue-review-über-mehrere-modelle).

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

Als konkretes Beispiel führt das Kit-Repo darüber ein **automatisch generiertes `CHANGELOG.md`**: Ein Script (`tools/changelog.mjs`) leitet die Einträge bei jedem Release aus der Git-Historie ab (die Commit-Betreffzeilen, gruppiert an den Versions-Commits) — von Hand gepflegt wird nichts. Das ist Teil der Kit-eigenen RELEASING.md; Projekte, die das Kit nutzen, bekommen es nicht automatisch, können es aber nach demselben Muster in ihre eigene RELEASING.md aufnehmen.

Zwei Details, die man beim Nachbauen leicht falsch macht: Der Changelog entsteht **nach** dem Versions-Commit und wandert per `git commit --amend` in denselben Commit — läuft er davor, kennt er die Marke nicht, die dieser Commit gerade setzt, und ist in dem Moment veraltet, in dem er geschrieben wird. Und Änderungen, die noch keinen Versions-Commit gesehen haben, stehen unter `[Unreleased]` statt unter der Versionsnummer aus der Konfiguration — die ist nach jedem Release bereits vergeben, und zwei Blöcke mit derselben Nummer sind kein Changelog mehr.

### Der Git-Tag ist deiner

Ein Release-Schritt erzeugt **keinen** Tag — weder bei `push main` noch bei `merge production`. Ein Tag markiert eine Veröffentlichung, und Veröffentlichungen bleiben menschlich, aus derselben Überlegung heraus wie die drei Stop-Punkte.

Was `/merge-production` stattdessen tut: Es gibt am Ende seines Laufs die fertige Kommandozeile aus, mit dem Hash des Versions-Commits, den es selbst erzeugt hat:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
gh release create vX.Y.Z --title vX.Y.Z --notes-file <pfad>
```

Der Unterschied zwischen „setz bitte noch einen Tag" und einer kopierbaren Zeile ist nicht Bequemlichkeit, sondern ob es passiert: Wer nach jedem Release Hash und Syntax selbst zusammensuchen muss, lässt es irgendwann bleiben.

Beim `push main`-Trigger entsteht bewusst kein Tag — dort entstehen interne Patch-Stände, die niemand veröffentlicht.

### /retro

**Werkzeug neben dem Prozess, alle ein bis zwei Wochen.**

Die KI-Retrospektive ist kein Entwicklungszyklus-Schritt, sondern ein Wartungsschritt für den Prozess selbst. Drei Fragen: Wo hat die Mensch-KI-Zusammenarbeit gehakt? Welche Memory-Einträge sind veraltet oder falsch? Welche Workflow-Regel braucht eine Schärfung?

Der Output sind keine Erkenntnisse, sondern konkrete Änderungen an den Konventionsdateien und am Memory. Wenn eine Retrospektive keine Datei verändert, war sie zu abstrakt.

### /document

**Werkzeug neben dem Prozess, Session-Ende.**

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

## Zwei Bahnen

Nicht jede Aufgabe braucht den vollen 9-Schritt-Prozess. Das Kit unterscheidet zwei Bahnen:

**Bahn 1 — Kleine Änderung.** Genau eine Datei, ein Asset oder ein Config-Wert; keine Datenbank-Migration; kein neuer oder geänderter Endpoint; kein Datenmodell; höchstens ein Modul betroffen; keine sicherheitsrelevante Logik. Direkt umsetzen, ein Commit, kein Push ohne Trigger-Phrase — kein Plan, kein Issue, kein GO.

**Bahn 2 — Feature.** Berührt Datenmodell, API/Endpoint, Migration, Sicherheit oder mehr als ein Modul, oder der Aufwand übersteigt etwa einen Commit. Voller Prozess: `/plan` → `/issues` → GO → `/implement-ready`.

Im Zweifel gilt Bahn 2. Vor jeder neuen Aufgabe benennt die KI die Bahn laut ("Das ist Bahn 1/2, ich …") — Beispiele: ein Icon- oder Favicon-Tausch, eine Textkorrektur oder ein Config-Default sind Bahn 1; eine neue Tabelle, ein neuer Endpoint oder ein neues UI-Feature sind Bahn 2.

## PO-Schleife: fachliche und technische Issues

In der Praxis gießt ein Product Owner (oder ein Proxy-PO in der Firma) die Anforderungen ein — und will den Plan fachlich abnehmen, bevor Technik entsteht. Dafür trennt das Kit optional zwei Issue-Sorten nach dem Discovery/Delivery-Muster:

- **Fachliche Issues** (Titel-Präfix `[Fachlich]`, angelegt per [/fachplan](#fachplan)): beschreiben in PO-Sprache das Was und Warum — Story-Format mit Ziel, fachlichen Akzeptanzkriterien, Nicht-Zielen und offenen Fragen. Sie werden am Board **gegroomt** — die Verhandlung mit dem PO läuft **im Body** (Antworten und Ergänzungen direkt am Text), nicht in Kommentaren — und **nie implementiert**.
- **Technische Issues** (Vier-Abschnitt-Format wie gehabt): entstehen erst, wenn der PO sagt „das ist es" — dann liest `/plan #N` das fachliche Issue **mit seinem vollständigen Body** als Anforderungsquelle, und `/issues` schneidet daraus die technischen Issues.

**Der Ablauf:**

1. `/fachplan <Anforderung>` → fachliches Issue in Backlog (bzw. im Ideen-Pool, siehe unten).
2. Groomen direkt am Issue, bis der PO die fachliche Freigabe gibt.
3. `/plan #N` → technischer Plan aus dem fachlichen Issue.
4. `/issues` → technische Issues; jedes trägt die Rückverweise **im Kontext-Abschnitt**.
5. Ab hier der normale Weg: GO, `/implement-ready` oder Nachtbetrieb, Review, Push.

**Die Regeln dahinter:**

- **Zwei Rückverweise, beide im Kontext.** Die Kette soll an jedem Punkt lesbar sein — vom Arbeitspaket zum Plan, vom Plan zur fachlichen Anforderung. Deshalb tragen die technischen Issues untereinander, in dieser Reihenfolge:

  ```
  Plan: Issue #M
  Fachliche Quelle: Issue #N
  ```

  Die `Plan:`-Zeile entsteht nur, wenn ein `[Plan]`-Issue als Quelle vorliegt; wurde der Plan bloß in derselben Session freigegeben, bleibt sie weg. Sie ist unabhängig von `Plan-Modell:` — jene nennt den **Urheber** des Plans, diese seinen **Fundort**.
- **Nie in den Abhängigkeiten — beide nicht.** Eine `Issue #N`-Referenz im Abhängigkeiten-Abschnitt würde der Nacht-Runner als unerfüllte Abhängigkeit werten. Das fachliche Issue wird erst Done, wenn seine technischen Kinder fertig sind, das Plandokument wird durch Umsetzung nie Done — alle Kinder blieben dauerhaft zurückgestellt (Henne-Ei).
- **Fachliche Issues gehen nie nach Ready.** Ready heißt implementierbar. Landet doch eines dort, greift die mechanische Leitplanke: `/implement-ready`, `/implement-next` und der Nacht-Runner stellen es kommentiert zurück ins Backlog, ohne eine Session zu starten. Dasselbe Gate greift für **Ideen** (Titel-Präfix `[Idee]`) — eine rohe Idee braucht erst `/plan` und `/issues`, bevor sie implementierbar ist — und für **Plandokumente** (Titel-Präfix `[Plan]`): Ein Plan beschreibt einen Weg, er ist keine Aufgabe und muss erst per `/issues` in Arbeitspakete zerlegt werden.
- **Lebenszyklus:** Fachliche Issues und Plandokumente bewegt **ausschließlich der Mensch** aus dem Backlog heraus — kein Skill zieht sie je selbst weiter, die Leitplanken schieben sie nur aus Ready zurück. Zwei Wege stehen offen, und sie sind **gleichwertig**: entweder **direkt nach Done**, sobald das Dokument seinen Zweck erfüllt hat, oder zunächst nach **In review** als Klammer, die den fachlichen Kontext während der Umsetzung sichtbar hält — Done dann, wenn die technischen Arbeitspakete durch sind. Welcher Weg passt, entscheidet der Mensch.

  **Eine Falle gehört dazu:** `night.mjs --review` liest ausschließlich die Backlog-Spalte. Wer ein Dokument **vor** seiner Prüfung als Klammer nach In review zieht, nimmt es dem Nachtlauf weg — es ist dann kein Kandidat mehr, und zwar ohne dass irgendetwas fehlschlägt. Der Ausweg ist der interaktive Aufruf `/issue-review #N` mit expliziter Nummer: Er arbeitet **unabhängig von Spalte und vorhandenem Marker**. Genau das macht ihn zum Ausweg.
- **Erkennung über den Titel (Stufe 1):** Das `[Fachlich]`-Präfix funktioniert bei allen vier Trackern ohne Adapter-Änderung. Eine echte Label-Achse (Labels gibt es in GitHub, GitLab und kanban-kit — die Board-Adapter-Schnittstelle reicht sie nur noch nicht durch) ist als Ausbaustufe vorgesehen.
- **kanban-kit-Einordnung:** Neue fachliche Issues landen dort im Projekt-Ideen-Pool — Pool = ungesichtete Rohanforderung, Einplanen ins Backlog = fachlich in Arbeit (ab da adressierbar und groombar), `/plan #N` = fachlich freigegeben.

Ohne PO ist die Schleife unsichtbar: `/plan` direkt aufzurufen bleibt der Normalweg.

## Nachtbetrieb

Der Nachtbetrieb arbeitet die Ready-Spalte unbeaufsichtigt ab — mit einer **frischen Session pro Issue**, damit über viele Issues kein Kontext akkumuliert und die Qualität nicht schleichend sinkt. Der Nacht-Runner (`.claude/kit/night.mjs`, kommt mit dem Installer) startet pro Issue eine Headless-Session mit `/implement-next #N` — das Issue wird der Session **verbindlich übergeben**, sie wählt es nicht selbst — wartet auf ihr Ende und prüft den Erfolg ausschließlich am Board: Issue in In review = Erfolg. Gepusht wird nachts **nie** — die drei Stop-Punkte bleiben unverändert menschlich.

**Abend-Ritual (das GO):** Issues nach Ready ziehen und per Drag&Drop in die gewünschte Reihenfolge bringen — der Runner arbeitet die Spalte von oben nach unten ab. Abhängigkeiten müssen als `Issue #N` im Abhängigkeiten-Abschnitt stehen (siehe Issue-Format): Der Runner stellt Issues mit unerfüllten `#N`-Referenzen automatisch zurück. Drei Sorten Issue überspringt er mechanisch — kommentiert zurück ins Backlog, ohne eine Session zu starten: fachliche Issues (`[Fachlich]`-Titel, [PO-Schleife](#po-schleife-fachliche-und-technische-issues)), **Ideen** (`[Idee]`-Titel) und **Plandokumente** (`[Plan]`-Titel). Eine rohe Idee ohne `/plan`-Zyklus ist kein implementierbares Issue; ein Plandokument beschreibt einen Weg und wird erst per `/issues` in Arbeitspakete zerlegt. Ohne das Gate würde eine Session sie zwar korrekt ablehnen, aber der Runner kann diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist verbrannt und der Kommentar am Board irreführend. Beim Plandokument wäre es schlimmer: Es trüge keinen Ablehnungsgrund in sich und würde umgesetzt, und das sähe am Board wie ein Erfolg aus.

**Start:**

```bash
node .claude/kit/night.mjs --dry-run   # zeigt, was laufen würde — startet nichts
node .claude/kit/night.mjs             # echter Lauf
```

Flags: `--max <N>` (Session-Limit pro Nacht, Default 10), `--model <id>` (Default `claude-opus-5`), `--timeout-min <N>` (Zeitlimit pro Runde, Default 60), `--dry-run`, `--no-checks-ok` (Start trotz leerer `buildChecks` — der Runner verweigert sonst, denn nachts ohne Gate zu implementieren ist riskant), `--yolo` (siehe Permissions), `--label <name>` (Routing-Label, Default `kit:nightrun`; `none` schaltet den Filter ab), `--verbose` (Live-Verlaufsprotokoll), `--help`. Dazu das Config-Feld `formatFixCommand` (siehe unten) — kein Flag, weil es projektspezifisch ist.

**Routing-Label — welche Ready-Issues der Nachtlauf bearbeitet.** Standardmäßig verarbeitet der Runner aus Ready nur Issues mit dem Label `kit:nightrun`; alle anderen bleiben unangetastet liegen (kein Verschieben, kein Kommentar). So markierst du auf **einem** Board gezielt die Teilmenge für den Nachtlauf und behältst den Rest für interaktive Arbeit — ohne ein zweites Board mit eigenem Token, das `Issue #N`-Abhängigkeiten zwischen den Boards unauflösbar machen würde. Das Label ist per `--label <name>` überschreibbar; `--label none` schaltet den Filter ganz ab (dann kommt wie früher strikt das oberste Ready-Issue dran). Ein `--dry-run` weist ungelabelte Issues sichtbar als „übersprungen" aus. Bei **GitLab** sind Labels bereits der Status-Mechanismus — wähle dort einen Routing-Label-Namen, der mit keinem Status-Label kollidiert (der Default `kit:nightrun` mit Namespace-Präfix tut das). **Tragweite:** Wer `night.mjs` bisher ohne Labels nutzte, muss seine Nacht-Issues jetzt mit `kit:nightrun` versehen oder `--label none` setzen — sonst findet der Lauf nichts.

Ohne `--verbose` protokolliert der Runner pro Runde nur Start und Ende — bei einer langen Session sieht man nicht, woran sie gerade arbeitet (`claude -p` gibt erst am Schluss seine Abschlussnachricht aus). Mit `--verbose` liest der Runner den `stream-json`-Output der Session live mit und schreibt kompakte Ereigniszeilen ins Nacht-Log und auf die Konsole — Tool-Aufrufe und Text-Snippets, jeweils mit der Issue-Nummer:

```
[18:24:10]   #401 > Bash: mvn -q verify
[18:25:02]   #401 > Edit: src/main/java/.../ProjectIdeaEventService.java
[18:26:11]   #401 > Claude: Tests grün, ich committe jetzt.
```

Die finale Abschlussnachricht landet wie gehabt zusätzlich im Log; das Streaming ergänzt sie, ersetzt sie nicht.

**Nachtlauf gegen ein anderes Board (Toolbox/kanban-kit).** Läuft dein Projekt gegen einen kanban-kit-Tracker, kannst du den ganzen Nachtlauf auf ein eigenes Night-Board umschalten: Token in der Admin-UI erzeugen und an das Night-Board binden, als zweite gitignorete Datei neben dem normalen `tokenFile` ablegen (z. B. `.claude/tbx-night.token`) und den Runner mit `TBX_TOKEN` pro Aufruf starten:

```bash
TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs
```

Das funktioniert, weil `TBX_TOKEN` die höchste Stufe der [Token-Precedence](#toolbox-privates-setup) ist und die Umgebungsvariable über die ganze Prozesskette vererbt wird: vom Runner an seine eigenen `board.mjs`-Aufrufe **und** an jede Headless-Session, deren `board.mjs`-Aufrufe sie wiederum erben. Der gesamte Lauf wechselt damit das Board — Ready-Quelle und alle Rückmeldungen (move, comment). Ein Split („Issues von Board B ziehen, auf Board A melden") ist bewusst nicht möglich: Das Board ist das einzige Koordinationssignal des Runners. Wichtig: `TBX_TOKEN` nur so, pro Aufruf, setzen — nie dauerhaft exportieren (etwa in `.zshrc`), sonst gewinnt es in **jedem** Projekt gegen dessen `tokenFile`. Das alles gilt nur für den Toolbox-/kanban-kit-Tracker; bei GitHub und GitLab ist das Board pro Repo über die Config getrennt (`github.projectNumber` bzw. Status-Labels), ein Umschalten pro Aufruf gibt es dort nicht.

**Modell-Angabe im Aktivitätsverlauf (kanban-kit).** Der Runner setzt jeder Session `KIT_AGENT_MODEL` auf den Wert von `--model`. Die Variable wird über dieselbe Prozesskette vererbt wie `TBX_TOKEN` — bis in die `board.mjs`-Aufrufe der Session — und der Adapter hängt sie als Header `X-Agent-Model` an jeden Board-Request. Im Aktivitätsverlauf steht dann neben der Herkunft auch, mit welchem Modell nachts gearbeitet wurde. Das ist ausdrücklich eine **Selbstauskunft des Clients, kein Nachweis**: Session und Token verifiziert der Server, das Modell nicht — die Board-Seite kennzeichnet den Wert entsprechend („lt. Angabe"). Interaktive Sessions setzen die Variable nicht und machen dadurch keine Angabe; keine Angabe ist ehrlicher als eine geratene. Serverseitig ausgewertet wird der Header nur von kanban-kit; andere Tracker ignorieren ihn.

**Permissions.** Unbeaufsichtigt heißt: niemand beantwortet Permission-Dialoge. Der Runner startet die Sessions deshalb mit `--permission-mode acceptEdits`; alles Weitere erlaubst du gezielt über eine Allowlist in `.claude/settings.json` des Projekts, z. B.:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(mvn:*)",
      "Bash(npm --prefix frontend:*)"
    ]
  }
}
```

Für den unbeaufsichtigten Betrieb erlaubst du am besten das **Werkzeug**, nicht das einzelne Kommando: `Bash(mvn:*)` statt `Bash(mvn verify:*)`. Der Grund ist das Präfix-Matching der Allowlist — ein Muster greift nur, wenn der Kommando-Anfang exakt passt. `Bash(mvn verify:*)` deckt `mvn verify` ab, aber nicht `mvn -q verify`, `mvn clean verify` oder ein `mvn test` für einen Teillauf; Sessions formulieren solche Varianten aber legitim. Ein tool-weiter Eintrag fängt alle. Die vier read-only-Git-Kommandos gehören ebenfalls hinein, damit eine Session beim Commit-Vorbereiten nicht an einem harmlosen `git status` scheitert. **Trade-off:** Ein tool-weiter Eintrag gibt der Session mehr Spielraum (beliebige `mvn`-Goals, beliebige `npm`-Scripts). Für projekteigene Build-Werkzeuge ist das nachts der pragmatische Schnitt; wer enger bleiben will, trägt die buildChecks stattdessen wörtlich ein (inklusive aller Flags) und zahlt dafür mit Runden, die an einer nicht vorhergesehenen Kommando-Variante scheitern.

Ein Kommando außerhalb der Allowlist wird im Headless-Betrieb sofort abgelehnt; eine gut erzogene Session implementiert dann zwar weiter, kann aber ihre Checks nicht ausführen und committet deshalb nicht — die Runde endet zeitnah ohne In-review-Ergebnis (dirty Tree → harter Stopp, sauberer Tree → Backlog), nicht erst nach `--timeout-min`. Das ist gewollt: lieber eine verlorene Runde als eine unbeaufsichtigte Aktion. Wer stattdessen `--yolo` setzt, schaltet **alle** Permission-Checks der Nacht-Sessions ab (`--dangerously-skip-permissions`); die Stop-Punkte hängen dann allein am Skill-Prompt. Bewusste Einzelfall-Entscheidung, kein Default.

**Zwei weitere Schichten: Sandbox und Umgebung.** Die Allowlist entscheidet, ob ein Kommando *erlaubt* ist — nicht, in welcher Umgebung es läuft. Claude Code führt Bash-Kommandos zusätzlich in einer **Sandbox** aus, die unter anderem Unix-Sockets abschottet. Braucht ein Check einen Socket (typisch: Testcontainers-Integrationstests über `mvn verify`, die den Docker-/Colima-Socket ansprechen), scheitert er trotz passender Allow-Rule an der Sandbox, und der Ausweg („ohne Sandbox erneut ausführen") ist ein interaktiver Prompt — nachts unbeantwortbar. Nimm solche Kommandos über [`sandbox.excludedCommands`](https://code.claude.com/docs/en/sandboxing) aus der Sandbox heraus:

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": ["mvn *"]
  }
}
```

Fehlt dem Check darüber hinaus eine **Umgebungsvariable** (z. B. `DOCKER_HOST`, damit Testcontainers den Socket findet), setz sie im `env`-Block der `settings.json` — **nicht** als Kommando-Präfix. Ein `env DOCKER_HOST=… mvn …` fällt nämlich aus beiden Mustern heraus: Das erste Token ist dann `env`, nicht `mvn`, also greifen weder die Allow-Rule `Bash(mvn:*)` noch `excludedCommands: ["mvn *"]`. Im `env`-Block gilt die Variable für jede Session, und `mvn` erbt sie ohne Präfix:

```json
{
  "env": {
    "DOCKER_HOST": "unix:///<pfad-zum>/docker.sock"
  }
}
```

Das Setup-Rezept für den Nachtbetrieb hat also drei Schichten, die alle passen müssen: die **Allowlist** erlaubt das Kommando, `sandbox.excludedCommands` befreit es von der Isolation, der `env`-Block versorgt es mit Variablen. (Für Testcontainers speziell tut es alternativ eine `~/.testcontainers.properties` mit `docker.host` — die liegt außerhalb des Projekts, ist dafür aber unabhängig von Claude Code.)

**Wenn etwas schiefgeht:** Der Runner unterscheidet drei Fälle. **Infrastruktur-Fehlstart** — die Session selbst endet mit Exit ≠ 0 (Auth abgelaufen, CLI kaputt): harter Stopp, das Issue bleibt unangetastet in Ready, denn mit ihm ist nichts falsch; die CLI-Fehlermeldung steht direkt im Konsolen-Log. So räumt eine kaputte Umgebung nicht die ganze Ready-Spalte leer. **Fachlicher Fehlschlag** — die Session endet sauber (Exit 0), aber das Issue steht nicht in In review: der Runner kommentiert es und stellt es zurück ins Backlog, der Lauf geht mit dem nächsten Issue weiter. Ein **Timeout** (`--timeout-min`) zählt als issue-spezifisch (Aufgabe zu groß) und wird wie ein fachlicher Fehlschlag behandelt. Hinterlässt eine Runde einen unsauberen Working Tree, stoppt der Lauf in jedem Fall hart (Exit ≠ 0): Auf halben Änderungen wird nicht weitergebaut. Vor dem Start prüft der Runner außerdem: kein Issue in In progress (Crash-Rest), sauberer Working Tree, `buildChecks` vorhanden.

**Salvage — wenn die Arbeit fertig ist, das Board es aber nicht weiß.** Eine Headless-Session hat keinen Folge-Turn. Startet sie einen langen Check im Hintergrund und beendet ihren Turn, bevor das Ergebnis da ist, ist es verloren — das Board zeigt einen Fehlschlag, obwohl die Arbeit vollständig war. Bevor der Runner bei „nicht in In review UND dirty" hart stoppt, führt er deshalb die `buildChecks` selbst aus. Sind sie grün, bekommt **genau eine** Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue zu prüfen, zu committen und das Board zu bewegen (Zeitlimit 10 Minuten; sie führt keine Builds mehr aus). Rote Checks oder ein gescheiterter Versuch führen zum harten Stopp, jeweils mit eigener Log-Zeile. Die Vorprüfung merged dabei den `env`-Block aus `.claude/settings.json` und `.claude/settings.local.json` in ihre Umgebung — sonst fehlen ihr projektspezifische Variablen (etwa für Testcontainers), die sonst nur Claude Codes eigene Bash-Aufrufe bekommen, und sie meldet ein falsches Rot.

**Plattform-Shell für `buildChecks` und `formatFixCommand`.** Beide Werte sind frei konfigurierte Kommandozeilen und brauchen deshalb zwingend eine Shell — anders als die festen Kommandos des Board-Adapters, der seit v1.27 ganz ohne Shell auskommt. Der Runner startet sie in der Shell der jeweiligen Plattform: `/bin/sh` unter macOS und Linux, die ComSpec-Shell (im Regelfall `cmd.exe`) unter Windows. Bewusst nicht PowerShell — der Wert ist eine Nutzer-Konfiguration, und `cmd.exe` ist das, was beim Eintragen eines Build-Kommandos unter Windows erwartet wird; PowerShell hätte zudem eine eigene Operator-Syntax (kein `&&` vor Version 7). **Folge:** Deine `buildChecks` sind damit potenziell plattformspezifisch. Ein `mvn verify` oder `npm test` läuft überall; eine Verkettung mit `&&`, eine Pipe oder eine Umleitung wie `2>/dev/null` verhält sich unter `cmd.exe` anders oder gar nicht. Wer dasselbe Projekt auf beiden Welten nachts laufen lässt, hält die Kommandos am besten einfach und ohne Shell-Operatoren.

**`formatFixCommand` — ein Formatverstoß darf keinen Lauf kippen.** Setzt du in der `workflow.config.json` ein Kommando, das Formatierung mechanisch repariert (`"formatFixCommand": "mvn spotless:apply"`, für Frontends etwa `"npx prettier --write ."`), dann läuft es bei roten Checks in der Salvage-Vorprüfung **genau einmal**, und die Checks werden **genau einmal** wiederholt. Werden sie dadurch grün, geht der Lauf weiter und das Protokoll weist den Eingriff mit `FORMAT-FIX angewendet` aus — kein stiller Eingriff. Bleiben sie rot, war das Format nicht die Ursache und es bleibt beim harten Stopp. Hintergrund: Ein einzelner falsch umbrochener Javadoc-Kommentar hat einmal einen kompletten Nachtlauf beendet, obwohl die Arbeit korrekt war. Ein Formatverstoß ist deterministisch behebbar und sagt nichts über die fachliche Qualität — ein fehlgeschlagener Test dagegen schon, und der bleibt unverändert ein harter Stopp. Ohne das Feld ändert sich nichts.

### Zweiter Modus: der Nacht-Review

Der Runner kann statt zu implementieren auch **prüfen lassen**: `--review` lässt Dokumente aus dem **Backlog** von [`/issue-review`](#issue-review-über-mehrere-modelle) durch fremde Modelle lesen — wie viele, entscheidet die [Prüfstufe](#drei-prüfstufen-die-prüfung-wandert-nach-oben). Morgens liegen die Befunde am Board, geschärfte Vorschläge als Kommentar, und die unauffälligen Dokumente tragen bereits den Prüf-Marker ihrer Stufe.

```bash
node .claude/kit/night.mjs --review --dry-run   # zeigt Kandidaten und Reviewer-Stand
node .claude/kit/night.mjs --review             # echter Lauf
```

Flags: `--review-label <name>` (Routing-Label, Default `kit:nightreview`; `none` schaltet den Filter ab), dazu `--max`, `--model` und `--verbose` wie gehabt. Das Zeitlimit liegt fest bei 15 Minuten pro Issue — ein Review baut nichts und committet nichts, `--timeout-min` bemisst eine ganze Implementierungsrunde.

**Warum der Backlog und nicht Ready — und warum zwei Nächte.** Zwischen Review und Implementierung liegt das GO, und das GO ist menschlich. Würde der Runner ein Ready-Issue erst prüfen und dann bauen, hätte der Mensch sein GO auf einen Text gegeben, der bei der Implementierung nicht mehr gilt — die Verantwortungsschwelle wäre umgangen, ohne dass es jemandem auffällt. Der Ablauf ist deshalb:

> Review-Nacht → morgens sichten und nach Ready ziehen → Implementierungs-Nacht

Zwei Läufe an zwei Abenden statt zweier Phasen in einer Nacht. Deshalb ist `--review` auch **exklusiv**: Die Implementierungsschleife läuft dann nicht.

Ein eigenes Routing-Label statt `kit:nightrun`, weil die Modi verschiedene Spalten meinen — `kit:nightreview` markiert Backlog-Issues zur Prüfung, `kit:nightrun` Ready-Issues zur Umsetzung. Welche Dokumente er nimmt, steuert `--stufe <fachlich|plan|issue>` (Default `issue`): `fachlich` nimmt genau die `[Fachlich]`-Issues, `plan` genau die `[Plan]`-Issues, `issue` weder das eine noch das andere. `[Idee]` bleibt in jeder Stufe ausgeschlossen. Ein Aufruf fährt genau eine Stufe — zwischen den Stufen steht die menschliche Freigabe. Übersprungen werden damit.

**Der Vorflug ist hier ein Gate.** `board.mjs issue-review check` ist für sich nur eine Auskunft — interaktiv fragt der Skill den Menschen, wenn ein Reviewer fehlt. Nachts fragt niemand, und ein Ein-Reviewer-Lauf sieht am Board aus wie ein vollständiger. Fehlt ein Reviewer oder ist der Tracker nicht erreichbar, stoppt der Lauf deshalb hart, **bevor** die erste Review-Session startet. Ein Opt-out gibt es bewusst nicht: Wer wissen will, ob alles steht, fährt vorher `--dry-run` — der meldet den Befund und bricht gerade nicht ab. Die `buildChecks`-Pflicht entfällt in diesem Modus, weil nichts gebaut und nichts committet wird.

**Der Vorflug läuft in einer eigenen Session, nicht im Runner.** Der Reviewer wird nicht dort gebraucht, wo der Runner steht, sondern in den Review-Sessions — eigene Kindprozesse mit eigener Sandbox, eigener Netzwerk-Allowlist und eigenen Freigaben. Ein Probelauf im Runner beweist nur, dass *der Runner* das Werkzeug starten darf. In der Nacht vom 08.08.2026 lief er sauber durch, während `codex exec` in der Session an „Run outside of the sandbox" scheiterte und `board.mjs issue get` an der leeren Netzwerk-Allowlist: ein Lauf, der vollbesetzt startete und mit einem Reviewer arbeitete.

`night.mjs --review` startet deshalb **genau eine Vorflug-Session** — gleiche Bauart, gleicher Startpfad, gleiche Rechte wie eine spätere Review-Session, aber mit festem günstigem Modell und kurzem eigenem Zeitlimit, damit `--dry-run` billig und schnell bleibt. Sie startet jedes `kind: "command"`-Kommando einmal direkt mit dem Prompt über stdin (ausdrücklich **nicht** über `board.mjs issue-review check` — dieser Pfad steht in `sandbox.excludedCommands` und misst damit wieder die falsche Umgebung) und prüft die Erreichbarkeit des Trackers. Jeder Befund nennt die Umgebung: `review-session` aus dem Vorflug, `runner` aus `board.mjs issue-review check`. Die Tracker-Erreichbarkeit ist ein **eigener** Befund — bei Issue #248 scheiterte nicht der Reviewer, sondern das `issue get`, und wer das als Reviewer-Ausfall meldet, schickt den Menschen morgens in die falsche Ecke. Lässt sich die Vorflug-Session gar nicht starten oder liefert sie keinen auswertbaren Befund, ist auch das ein eigener Grund zum Stopp. Verschmutzt sie den Working Tree, gilt derselbe harte Stopp wie nach einer regulären Review-Session. Der interaktive Pfad (`/issue-review`, Schritt 0) bleibt unverändert — dort läuft der Befehl ohnehin schon in einer echten Session.

**Drei Ausgänge pro Issue**, und der mittlere ist der wichtigste:

| Was die Session hinterlässt | Bewertung |
|---|---|
| Marker im Body | geprüft, ohne gewichtigen Befund |
| kein Marker, aber Befunde als Kommentar | **geprüft, mit Befund** — wartet planmäßig auf dich |
| nichts | ohne Ergebnis; das Issue wird kommentiert, der Lauf geht weiter |

Der mittlere Fall ist ausdrücklich ein **Erfolg**, kein Fehlschlag: Es sind genau die Issues, bei denen sich der Review gelohnt hat. Kein Issue wird in diesem Modus am Board bewegt — die Kandidaten liegen bereits im Backlog. Hinterlässt eine Review-Session Änderungen im Working Tree, stoppt der Lauf hart; sie hat dort nichts zu suchen.

**Was die Nacht darf und was nicht:** Sie schreibt **nie** den Issue-Body. Der geschärfte Vorschlag geht als Kommentar ans Issue, und der Marker wird nur gesetzt, wenn kein Fund `BLOCKER` oder `WICHTIG` trägt und kein Reviewer ausgefallen ist. Die Begründung steht unter [Wer entscheidet](#wer-entscheidet).

#### Allowlist für fremde Reviewer

Reviewer mit `kind: "claude"` laufen als Subagenten und brauchen keine Permission. Ein Reviewer mit **`kind: "command"`** läuft dagegen über Bash — und steht er nicht in der Allowlist, erscheint nachts ein Permission-Prompt, den niemand beantwortet. Das ist kein Fehler mit Log-Zeile: **Die Session hängt bis zum Timeout.** Trag das Werkzeug deshalb ein, bevor der erste Review-Lauf startet:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(codex:*)"
    ]
  }
}
```

Der Eintrag nennt das **Werkzeug**, nicht die volle Kommandozeile — aus demselben Grund wie bei den buildChecks oben (Präfix-Matching). Wer mehrere fremde CLIs konfiguriert hat, trägt jedes einzeln ein. Ein Setup mit ausschließlich `kind: "claude"`-Reviewern braucht davon nichts.

### Mit einem lokalen Modell fahren

> **Ungetestet.** Dieser Abschnitt beschreibt einen Weg, der sich aus der Architektur des Runners ergibt und ohne jede Änderung am Kit funktionieren sollte — er ist hier aber **nicht praktisch erprobt**. Weder wurde LiteLLM aufgesetzt noch ein Lauf gegen ein lokales Modell gefahren. Nimm ihn als begründeten Vorschlag, nicht als Erfahrungsbericht.

Die Idee: einfache Issues nachts von einem lokalen Modell bauen lassen, während Review und anspruchsvolle Issues weiter über Anthropic laufen.

**Warum ein Proxy nötig ist.** Claude Code spricht ausschließlich die Anthropic Messages API; lokale Runner wie Ollama sprechen das OpenAI-Format. Dazwischen gehört ein Übersetzer — üblich ist [LiteLLM](https://docs.litellm.ai/). Zwei Dinge sind dabei unterschiedlich belastbar: Dass Claude Code über `ANTHROPIC_BASE_URL` auf einen eigenen Endpunkt zeigen kann, ist [offiziell dokumentiert](https://code.claude.com/docs/en/llm-gateway) (Gateway-Muster), ebenso `--model` pro Aufruf. Ein lokales Modell hinter diesem Endpunkt zu betreiben ist dagegen Community-Terrain und von Anthropic nicht supportet.

Eine minimale LiteLLM-Konfiguration:

```yaml
model_list:
  - model_name: lokal-qwen
    litellm_params:
      model: ollama/qwen2.5-coder:14b
      api_base: http://localhost:11434
```

**Mischbetrieb: die Variable dem Kommando voranstellen, nicht exportieren.**

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 3
```

`ANTHROPIC_BASE_URL` wirkt global für einen Prozess, `--model` dagegen pro Aufruf — das klingt nach einem Hindernis für den Mischbetrieb, ist hier aber keins. Der Runner startet jede Session als eigenen Kindprozess und reicht dabei `process.env` durch. Stellst du die Variable **dem Nachtlauf-Kommando voran**, gilt sie ausschließlich für dessen Sessions; eine parallel laufende interaktive Claude-Code-Sitzung bleibt unberührt. Ein `export` in der `.zshrc` würde genau das kaputt machen — dann liefe auch deine interaktive Arbeit über den Proxy.

**Aufteilung über Labels.** Das [Routing-Label](#nachtbetrieb) genügt für die Trennung, ein neues Flag braucht es nicht: Vergib den einfachen Issues ein eigenes Label (etwa `kit:lokal`) und fahre zwei Läufe nacheinander — einen mit lokalem Modell und diesem Label, einen regulären mit `kit:nightrun`.

**Der Review bleibt unberührt.** `/review` nutzt das `reviewModel` aus der `workflow.config.json` und ist vom Nachtlauf-Modell vollständig entkoppelt. Was ein lokales Modell nachts gebaut hat, wird morgens trotzdem vom starken Modell begutachtet.

**Wo die Grenzen liegen — ungeschönt.** Eine Nacht-Session muss mehr können als Code schreiben: Sie muss Werkzeuge zuverlässig aufrufen (Board-Operationen über `board.mjs`, Datei-Edits, Git), eine mehrstufige Kette durchhalten und am Ende sauber committen. Kleine Modelle brechen erfahrungsgemäß genau daran, nicht am Programmieren selbst. Projekte mit scharfen Gates — Mutationstests, Coverage-Ratchets, mehrstufige Build-Ketten — sind für ein kleines lokales Modell realistisch außer Reichweite. Der sinnvolle Einsatzbereich sind Änderungen ohne Testpflicht: Dokumentation, Textkorrekturen, Konfigurationswerte, kleine mechanische Anpassungen.

**Was schützt, wenn es schiefgeht.** Nichts Kaputtes gelangt ins Repo: Die [Salvage-Vorprüfung](#nachtbetrieb) fährt die `buildChecks` selbst, bevor überhaupt etwas committet wird, rote Checks führen zum harten Stopp, und der Rest-Guard beendet den Lauf, sobald eine Runde unkommittete Reste hinterlässt. Ein gescheiterter lokaler Lauf kostet dich Strom und Zeit, nicht die Codebasis.

**Einstieg.** Fang mit einem einzigen Doku-Issue an:

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 1 --verbose
```

`--verbose` zeigt im Protokoll jeden Tool-Aufruf der Session. Daran siehst du binnen Minuten, ob das Modell die Board-Operationen sauber hinbekommt — das ist der schnellste Machbarkeitstest, und er entscheidet die Frage, bevor du eine ganze Nacht investierst.

**Morgen-Ritual:** Protokoll lesen (`.claude/night-run-<datum>.log`: Issue, Dauer, Ergebnis, Commit pro Runde), dann wie immer `/review` → eigener Test → `push main`. Zurückgestellte Issues stehen kommentiert im Backlog.

## Leitplanken statt Prompts

Ein Sprachmodell reproduziert das häufigste Muster seines Trainingskorpus, nicht das aktuellste. Eine vor Monaten abgekündigte API steht in Millionen Zeilen Altcode noch als der normale Weg; der Abkündigungshinweis ist ein Randfall gegen diese Masse. Das Ergebnis ist ein Denkfehler, vielfach materialisiert: dasselbe veraltete oder abgekündigte Idiom, über alle Aufrufstellen ausgerollt — und oft erst spät in einer externen Analyse sichtbar.

Für solche wiederkehrenden, klassenweiten Fehler gilt dasselbe Prinzip wie beim Coverage-Gate: eine **harte Leitplanke, die im Pflicht-Gate scheitert**, statt ein Prompt oder eine Doku, die bittet. Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen; eine Lint- oder Compiler-Regel in den `buildChecks`, die Agent und CI ohnehin durchlaufen, kann gar nicht erst grün committen. Konkret:

- **Die Leitplanke leitet aus vorhandenen Annotationen ab**, statt eine handgepflegte Verbotsliste zu führen, die selbst veraltet: `@typescript-eslint/no-deprecated` liest JSDoc-`@deprecated`, Java meldet mit `-Xlint:deprecation` und `-Werror` jede abgekündigte API als Build-Fehler, Linter-`recommended`-Sets decken die gängigen veralteten Idiome ab. Der Analyzer skaliert mit dem Ökosystem, die Liste nur mit der Pflegedisziplin.
- **Das Gate ist der Hauptfang, SonarQube o. Ä. das Sicherheitsnetz.** Der Round-Trip über main fängt sicher, aber spät — der Fehler ist dann schon auf main. Der Check gehört nach vorn, in `/local-check` und `/implement-ready`, wo der Agent ihn vor Abschluss läuft.
- **Der konkrete Regel-Katalog lebt im jeweiligen Projekt** (`buildChecks` in der Config, Lint-Setup im Repo), nicht im Kit. Das Kit verankert nur das übertragbare Prinzip.

## Issue-Review über mehrere Modelle

Ein Issue ist die Quelle der Wahrheit für die Implementierung. Ein Fehler darin kostet mehr als ein Fehler im Code, weil er sich in die ganze Umsetzung fortpflanzt — und der Autor sieht ihn nicht, weil er den Kontext im Kopf hat, aus dem das Issue entstanden ist. Was er nicht hingeschrieben hat, ergänzt er beim Lesen unbewusst.

`/issue-review` sitzt zwischen `/issues` (Schritt 3) und dem GO (Schritt 4): Modelle, die das Dokument **nicht** geschrieben haben, lesen es und schlagen Schärfungen vor.

### Drei Prüfstufen — die Prüfung wandert nach oben

Der Skill prüft nicht eine Sorte Dokument, sondern drei. Welche Stufe greift, entscheidet das Titel-Präfix, und jede Stufe hinterlässt ihren eigenen Nachweis:

| Stufe | Prüft | Nachweis |
|---|---|---|
| `fachlich` | ein `[Fachlich]`-Issue — die fachliche Anforderung aus [/fachplan](#fachplan) | `Fachplan-Review: …` |
| `plan` | ein `[Plan]`-Issue — das Plandokument aus [/plan](#plan) | `Plan-Review: …` |
| `issue` | ein technisches Arbeitspaket aus [/issues](#issues) | `Issue-Review: …` |

**Wo der Nachweis steht**, richtet sich nach dem Format des Dokuments. Nur das Arbeitspaket hat einen `## Kontext`; Story- und Plan-Format führen ihre Kennzeichnungszeilen anderswo, und der Marker stellt sich dazu:

| Dokument | Ort des Markers |
|---|---|
| Arbeitspaket | im Abschnitt `## Kontext` |
| fachliche Anforderung | im Abschnitt `## Ziel`, unmittelbar bei `Autor-Modell:` |
| Plandokument | vor `## Ziel`, unmittelbar bei `Plan-Modell:` und gegebenenfalls `Fachliche Quelle:` |

Die Reihenfolge der vorhandenen Kennzeichnungszeilen bleibt dabei unverändert.

**Der Aufruf ist immer derselbe: `/issue-review #N`.** Es gibt bewusst kein `/fachplan-review` und kein `/plan-review` — welche Stufe greift, liest der Skill am Titel-Präfix ab. Drei Kommandos wären drei Wege, die Stufe falsch zu wählen; das Dokument weiß selbst, was es ist.

Das gilt **interaktiv genauso wie im Nachtbetrieb**. Ein Plandokument muss nicht auf einen Nachtlauf warten: `/issue-review #276` fährt tagsüber die Plan-Rollen und fragt dich am Ende nach dem geschärften Body. Der Unterschied zwischen den Betriebsarten liegt nicht in der Stufenwahl, sondern darin, ob vor dem Schreiben gefragt wird: interaktiv zeigt der Skill den geschärften Body und fragt einmal, unbeaufsichtigt schreibt er ihn, sobald alle Funde die Klasse `korrektur` tragen. Geschützt sind dabei nicht die Stufen, sondern die Inhalte, die ein Mensch gesetzt hat — ein Fund auf eine PO-Antwort oder auf eine Architekturentscheidung wird nie angewendet, er zeichnet das Dokument mit `kit:klaeren`.

**Nur eine nicht leere Zeile `Issue-Review:` gibt die Umsetzung frei.** An ihr hängt das Gate `requiredBeforeReady`; `Fachplan-Review:` und `Plan-Review:` ersetzen sie nie. Sie belegen die Prüfung einer früheren Stufe, nicht die des Arbeitspakets — wer sie verwechselt, zieht ein ungeprüftes Arbeitspaket nach Ready.

**Warum nach oben.** Die Reichweite eines Fehlers wächst nach unten: Ein Fehler in der fachlichen Anforderung pflanzt sich in den Plan fort, von dort in jedes Arbeitspaket und schließlich in allen Code. Derselbe Fehler, im Arbeitspaket gefunden, kostet ein Issue; in der Anforderung gefunden, kostet er einen Satz. Früher gefundene Fehler sind deshalb nicht nur billiger zu beheben — sie sind auch die, deren Behebung am meisten verhindert. Nebenbei wird das Verfahren günstiger: Bei dreizehn Arbeitspaketen aus einem Plan sind es 17 Prüfläufe statt 26.

**Warum das Arbeitspaket nur noch einen Prüfer hat.** Die bisherige zweite Rolle fragte nach Scope, Abhängigkeiten und Kollateralschäden im Bestand. Diese Fragen entscheiden sich im Plan, nicht im einzelnen Paket — ein Prüfer, der nur ein Paket vor sich hat, kann sie gar nicht beantworten. Belegt am 2026-08-08: Drei der vier Scope-Befunde jenes Laufs waren Fehlalarme an Abhängigkeitsgrenzen, weil der Prüfer das Nachbar-Issue nicht sah. Die Rolle ist deshalb nicht gestrichen, sondern als `schnitt-abhaengigkeiten` auf die Plan-Stufe gewandert, wo sie den ganzen Zuschnitt vor sich hat und tatsächlich wirkt. Was beim Arbeitspaket bleibt, ist die maschinelle Prüfbarkeit der Akzeptanzkriterien — sie hat auf den oberen Stufen kein Gegenstück, weil Akzeptanzkriterien erst dort entstehen.

**Warum ein Format nötig ist.** Ein Prüfer ohne festgelegte Form kann nur Geschmack äußern; mit ihr kann er prüfen. Beim Arbeitspaket sind es die vier Abschnitte, bei der fachlichen Anforderung das Story-Format aus `/fachplan` — und beim Plandokument diese sechs Überschriften, genau in dieser Reihenfolge:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

Leere Pflichtabschnitte werden ausdrücklich mit `- Keine.` ausgewiesen. Die festen Überschriften sind der Maßstab, gegen den die Stufe `plan` prüft: Fehlt einer, steht er an falscher Stelle oder trägt eine Entscheidung ohne Begründung, ist das ein Fund und keine Geschmacksfrage.

**Rückwärtskompatibilität.** Die Besetzung je Stufe steht im Config-Block `reviewStufen`; die mitgelieferte Vorlage konfiguriert für `issue` genau einen Reviewer. Bestehende Installationen **ohne** diesen Block behalten unverändert die bisherige Besetzung mit zwei Reviewern und den bisherigen beiden Rollen — erst ein ausdrücklich geschriebener Block aktiviert die neue Besetzung. Ein Kit-Update ändert das Prüfverfahren also nicht im Vorbeigehen.

```json
"reviewStufen": {
  "fachlich": { "reviewer": 2, "rollen": ["form-beobachtbarkeit", "abgrenzung"] },
  "plan":     { "reviewer": 2, "rollen": ["architektur-bestand", "schnitt-abhaengigkeiten"] },
  "issue":    { "reviewer": 1, "rollen": ["pruefbarkeit"] }
}
```

Welche Rolle welcher Reviewer übernimmt, lässt sich ablesen statt ausrechnen:

```bash
node .claude/kit/board.mjs issue-review roles --stufe issue --author claude-opus-5
```

### Welche Dokumente drankommen

**Ohne Argumente** nimmt `/issue-review` die Dokumente aus dem **Backlog**, die noch keinen Marker **ihrer Stufe** tragen. Ein bereits geprüftes Dokument läuft nicht erneut — und ein Marker der falschen Stufe zählt nicht: Ein `[Plan]`-Dokument mit `Plan-Review:` ist geprüft, eines mit `Issue-Review:` wäre es nicht.

**Ready wird nie automatisch erfasst**, auch interaktiv nicht. Der Grund ist derselbe wie beim [Nacht-Review](#zweiter-modus-der-nacht-review): Zwischen Prüfung und Implementierung liegt dein GO. Ready heißt „freigegeben zur Umsetzung" — dorthin soll nichts Ungeprüftes mehr gelangen, also prüft der Skill davor.

**Mit Nummern** arbeitet er genau die genannten ab — **unabhängig von Spalte und Marker**:

```bash
/issue-review #205 #207
```

Damit lässt sich ein bereits geprüftes Dokument erneut prüfen (etwa nachdem sich die Anforderung geändert hat), und ebenso ein Ready-Issue nachträglich.

**Einzelne Issues ausnehmen** braucht keine Markierung am Ticket: Nenn sie einfach nicht. Wer von acht Ready-Issues zwei auslassen will, listet die anderen sechs auf. Aus dem Review ausgenommen zu sein heißt allerdings nicht, dass das Gate sie durchlässt — bei `"requiredBeforeReady": true` stellt der Nachtlauf ein Issue ohne `Issue-Review:`-Marker weiterhin zurück.

`[Idee]`-Dokumente sind in jedem Fall ausgeschlossen, auch mit expliziter Nummer. Eine rohe Idee ohne `/plan`-Zyklus ist kein prüfbares Dokument; der Skill nennt sie in der Zusammenfassung, damit niemand sie für geprüft hält.

### Konfiguration

Der Installer legt eine Vorlage zum Abschreiben neben die echte Config:

```
.claude/workflow.config.example.json
```

Daraus den `issueReview`-Block in die eigene `.claude/workflow.config.json` kopieren und an die eigenen Modelle anpassen. **Der Installer fragt den Block nicht ab und schreibt ihn auch nicht selbst** — `reviewers` hängt davon ab, welche CLIs auf der Maschine liegen, und `pairs` ist eine Entscheidung, keine Voreinstellung. Ein automatisch geschriebener Block, von dem ein Reviewer fehlt, macht jeden Vorflug rot.

Ohne den Block tut `/issue-review` nichts, und `night.mjs --review` bricht im Vorflug ab, statt eine Nacht lang Sessions ergebnislos zu starten.

Die Beispieldatei wird bei jedem Re-Install aufgefrischt — sie enthält keine eigenen Werte. Die echte `workflow.config.json` bleibt davon unberührt.

```json
"issueReview": {
  "rounds": 1,
  "requiredBeforeReady": false,
  "reviewers": [
    { "name": "opus",   "kind": "claude", "model": "claude-opus-5" },
    { "name": "sonnet", "kind": "claude", "model": "claude-sonnet-5" },
    { "name": "fable",  "kind": "claude", "model": "claude-fable-5" }
  ]
}
```

Die Vorlage bringt nur die Anthropic-Familie mit. Ein fremdes Modell kommt als zusätzlicher Eintrag dazu — mehr dazu unten. Es ist bewusst nicht voreingestellt: Nicht jeder hat Codex installiert, manche wollen Gemini, und eine Vorlage, deren Vorflug beim ersten Lauf rot meldet, schreckt ab.

Wer wen prüft, steht in `pairs`:

```json
"pairs": {
  "opus":   ["sonnet", "fable"],
  "sonnet": ["opus", "fable"],
  "haiku":  ["sonnet", "opus"]
}
```

Steht der Autor dort, gewinnt sein Eintrag. Sonst greift eine Regel: die vordersten Reviewer, die nicht der Autor sind. Wie viele davon tatsächlich laufen, kürzt anschließend die Prüfstufe.

**Verlass dich nicht auf die Regel allein.** Sie wählt immer die vordersten Einträge — bei vier konfigurierten Reviewern kommt der vierte in keinem einzigen Fall zum Zug. Wer ein fremdes Modell hinten in die Liste schreibt, hat es damit faktisch abgeschaltet. Genau das ist beim Bau dieses Verfahrens passiert, und es ist der Grund, warum es `pairs` gibt.

Die vollständige Zuordnung lässt sich ablesen statt ausrechnen:

```bash
node .claude/kit/board.mjs issue-review matrix
```

```
opus     -> codex, sonnet      (pairs)
fable    -> opus, sonnet       (regel)
```

Die Spalte `quelle` sagt, ob die Zeile aus `pairs` oder aus dem Fallback stammt. Wer dort `regel` liest, obwohl er einen Eintrag erwartet hatte, hat den Autor-Namen anders geschrieben.

Zwei Dinge sind harte Fehler, keine stillen Skips: ein Name in `pairs`, den es in `reviewers` nicht gibt, und ein Autor, der sich selbst nennt.

Das Autor-Modell steht als Zeile `Autor-Modell:` im Kontext-Abschnitt des Issues; `/issues` schreibt sie beim Anlegen aus `KIT_AGENT_MODEL`. In einer interaktiven Session ist der Wert `unbekannt` — dann werden einfach die vordersten Reviewer genommen, so viele wie die Stufe vorsieht.

### Fremde Modelle anbinden

Das ist der Punkt, an dem sich `issueReview` von einer Modell-Liste unterscheidet: Ein Reviewer ist ein **Adapter**, kein Claude-Modell.

| `kind` | Wie es läuft |
|---|---|
| `claude` | Subagent über das Agent-Tool, mit dem konfigurierten `model` |
| `command` | beliebiges CLI: Prompt über **stdin** hinein, Antwort von **stdout** heraus |

Damit nimmt jedes Werkzeug teil, das Text liest und Text schreibt — Codex, Gemini, ein selbstgebautes Skript. **Das Kit kennt das fremde Werkzeug nicht und muss es nicht kennen.** Es prüft beim Vorflug nur, ob das erste Wort der Kommandozeile im PATH liegt.

Der Prompt geht über stdin, nicht als Argument. Ein Issue-Body enthält Backticks, Anführungszeichen und Zeilenumbrüche; ihn durch eine Kommandozeile zu quoten ist genau die Fehlerklasse, die aus dem Board-Adapter entfernt wurde.

### Die Rollen

Jeder Prüfer bekommt denselben Body, aber seinen eigenen Auftrag. Auf der Stufe `issue` läuft davon nur die erste Zeile — die zweite ist als `schnitt-abhaengigkeiten` auf die Plan-Stufe gewandert:

| Stufe | Rolle | Fragt |
|---|---|---|
| `fachlich` | `form-beobachtbarkeit` | Trägt die Anforderung alle vier Story-Abschnitte? Ist jedes Kriterium aus Nutzersicht beobachtbar? Steht Technik drin, wo keine hingehört? |
| `fachlich` | `abgrenzung` | Widersprechen sich Ziele und Nicht-Ziele? Fehlt eine Scope-Grenze? Ist eine offene Frage längst entschieden? |
| `plan` | `architektur-bestand` | Stimmt jede Behauptung über den Bestand? Trägt jede Entscheidung eine Begründung? Was bricht, das der Plan nicht nennt? |
| `plan` | `schnitt-abhaengigkeiten` | Lässt sich der Plan überhaupt zerlegen? Welche Reihenfolge erzwingt er? Sind die offenen Fragen wirklich Stopp-Fragen? |
| `issue` | `pruefbarkeit` | Ist jedes Akzeptanzkriterium maschinell prüfbar? Steht Manuelles im dafür vorgesehenen Block? Fehlen Randfälle? |

Mehrere Modelle mit identischem Prompt sind kein zweiter Blick, sondern derselbe Blick zweimal. Der Gewinn liegt im Blickwinkel, nicht in der Anzahl — deshalb Rollen und nicht bloß Wiederholung.

Ohne konfigurierten `reviewStufen`-Block gilt für alle Stufen der Legacy-Fallback: zwei Reviewer mit den Rollen `vollstaendigkeit-pruefbarkeit` und `scope-risiko-bestand`, inhaltlich die bisherigen beiden.

**Jede Rolle trägt die Streich-Frage: „Was kann raus?"** Reviewer schlagen von sich aus Ergänzungen vor, weil Ergänzen leichter ist als Streichen. Ohne diese Frage ist das Dokument nach dem Review doppelt so lang und nicht besser implementierbar. Die Frage ist kein Feinschliff, sondern die Gegenkraft, ohne die das Verfahren kippt.

### Die Gate-Register: woran ein Fund gemessen wird

Nicht jeder Fund wiegt gleich. Die meisten sind Schärfungen, die man anwendet oder verwirft. Manche verletzen eine Regel, an der etwas hängt — und dann soll nicht die Maschine entscheiden, sondern ein Mensch.

Welche Regeln das sind, steht in zwei Dateien, die der Installer neben `CLAUDE-workflow.md` ablegt:

| Datei | Gilt für | Gates |
|---|---|---|
| `CLAUDE-Fachplan.md` | fachliche Anforderung (`[Fachlich]`) | F1–F11 |
| `CLAUDE-Plan.md` | Plandokument (`[Plan]`) | P1–P12 |

Beide sind **Register, keine Ratgeber**: Jeder Eintrag ist eine Regel, gegen die ein Dokument verstoßen *kann*, und jeder trägt eine Nummer. Wer im Review „F5 verletzt" schreibt, zeigt auf eine Stelle statt auf einen Geschmack. Die prozessweiten Regeln — drei Stop-Punkte, Git-Workflow, Pflichtchecks — stehen weiterhin in `CLAUDE-workflow.md` und gelten daneben.

**Ein Fund ist `gate`, wenn eines von beiden zutrifft:** Er zeigt, dass das Dokument gegen eine dieser Regeln verstößt — oder das, was er vorschlägt, würde bei Übernahme dagegen verstoßen. Beide Richtungen zählen, weil der Schaden derselbe ist: einmal ist die Regel schon verletzt, einmal würde das automatische Anwenden sie verletzen. In beiden Fällen wird `kit:klaeren` gesetzt statt angewendet.

Umgekehrt gilt: **Alles, was nicht im Register steht, ist kein Gate.** Ob ein solcher Fund trotzdem einen Menschen ruft, hängt allein daran, ob er mehrere sinnvolle Alternativen aufmacht — das ist eine Eigenschaft des Fundes, nicht des Registers. Beide Dateien haben deshalb einen Abschnitt **„Ausdrücklich kein Gate"**. Ohne ihn erklärt ein Reviewer irgendwann jeden Fund zum Verstoß, und dann steht `kit:klaeren` an jedem Ticket.

Jedes Gate ist als `[maschinell]` oder `[Urteil]` markiert — maschinell heißt: ohne menschliches Urteil prüfbar, also später ein Testfall. Für diese gelten zwei Ausführungsregeln, die im Register selbst stehen: Der Body wird **ohne Codeblöcke** gelesen (Fence-Regel, Issue #308 — sonst zählt jedes Dokument, das das Format an einem Beispiel zeigt, seine Überschriften doppelt), und **Umlaute zählen in beiden Schreibweisen** (`Änderungen` wie `Aenderungen`).

Nummern werden **nie neu vergeben**. Ein gestrichenes Gate behält seine Nummer und wandert in den Abschnitt „Verbrannte Nummern", damit ein älterer Befund eindeutig bleibt.

### Wer entscheidet

Die Befunde gehen als Board-Kommentar ans Issue — das ist Verlauf. Der **Body** wird nie automatisch überschrieben: Der Skill zeigt einen Vorschlag und fragt einmal nach.

Zwei Modelle können sich einig und trotzdem falsch sein; Übereinstimmung ist kein Wahrheitskriterium. Und wer über die Anforderung entscheidet, entscheidet über das Produkt — das ist keine Modellfrage.

Nach der Zustimmung trägt das Dokument die Marker-Zeile **seiner Stufe** — `Fachplan-Review:`, `Plan-Review:` oder `Issue-Review:`, nie eine andere. Für ein Arbeitspaket, geprüft auf der Stufe `issue` mit seinem einen Reviewer, sieht sie so aus:

```
Issue-Review: codex (2026-08-06)
```

Eine fachliche Anforderung trüge an derselben Stelle `Fachplan-Review: codex, sonnet (2026-08-06)`, ein Plandokument `Plan-Review: …`. Der Anker `Issue-Review:` bleibt dem Arbeitspaket vorbehalten: An ihm hängt das Gate, und ein Plan mit dieser Zeile sähe für den Nacht-Runner freigabereif aus.

Wird der Vorschlag abgelehnt, entsteht **kein** Marker: Ein Review, dessen Ergebnis verworfen wurde, hat das Issue nicht geschärft.

Geschrieben wird über den Adapter, nicht am Tracker vorbei — `node .claude/kit/board.mjs issue update <id> --body "..."` funktioniert bei allen vier Trackern gleich.

### Im Nachtbetrieb

Läuft der Review über `night.mjs --review` (siehe [Zweiter Modus: der Nacht-Review](#zweiter-modus-der-nacht-review)), ist niemand da, der zustimmen könnte. Die Regel wird deshalb geteilt:

- **Der Body wird geschrieben, wenn alle Funde `korrektur` sind** (Issue #387). Bleibt mindestens ein `gate`- oder `alternativen`-Fund, werden die übernommenen `korrektur`-Funde trotzdem angewendet, `kit:klaeren` wird gesetzt und der Marker bleibt aus. Der fertig formulierte Vorschlag geht in beiden Fällen als Kommentar ans Issue.
- **Der Marker wird gesetzt**, wenn alle Funde `korrektur` sind und kein Reviewer ausgefallen oder unterbesetzt gefahren ist.

Der Grund für den Schnitt: **Die Verantwortungsschwelle liegt auf der Entscheidung, nicht am Text.** Ein wörtlich vorgeschlagener Fund, der nur einen Weg kennt, ist keine Produktentscheidung — ihn anzuwenden auch nicht. Wo dagegen eine Regel berührt ist oder mehrere Wege offenstehen, macht `kit:klaeren` das am Ticket sichtbar. Das GO bleibt vollständig deins: Nach Ready zieht weiterhin nur der Mensch.

**Beide Regeln gelten für alle drei Stufen** — auch für `fachlich` und `plan`. Wird der Body geschrieben, trägt das Dokument danach den Marker seiner Stufe; sonst bliebe es auf `review:offen` stehen und sähe ungeprüft aus, obwohl sein Body den Review bereits trägt. Am Gate ändert das nichts: `requiredBeforeReady` prüft allein `Issue-Review:`, und die oberen Stufen gehen ohnehin nie nach Ready.

Geschützt sind nicht die Stufen, sondern die Inhalte: In einer fachlichen Anforderung stehen die Antworten des Product Owners, in einem Plandokument die architektonischen Entscheidungen — beides hat ein Mensch getroffen. Ein `korrektur`-Fund, der eine dokumentierte PO-Antwort oder eine solche Begründung berührt, ist deshalb keiner: Er wird nicht angewendet, sondern zeichnet das Dokument mit `kit:klaeren`, und der Marker bleibt aus.

Ein nächtlich gesetzter Marker ist als solcher erkennbar — hier der eines Arbeitspakets, Stufe `issue`:

```
Issue-Review: codex (2026-08-06, Nachtlauf)
```

### Das Gate vor Ready

Mit `"requiredBeforeReady": true` stellt der Nacht-Runner Ready-Issues ohne Marker kommentiert ins Backlog zurück und fährt mit dem nächsten fort. Interaktiv weisen `/implement-ready` und `/implement-next` nur darauf hin und fragen — nachts antwortet niemand, tagsüber steht ein Mensch daneben.

Der Default ist `false`. Ein Kit-Update darf keinem Bestandsprojekt über Nacht den Runner anhalten; wer das Verfahren einführt, schaltet es bewusst ein.

### Zustandslabels: der Prüfstand am Ticket

Mit `"issueReview": { "statusLabels": true }` schreibt `issue-review label-sync <id>` den abgeleiteten Prüfzustand als Label ans Ticket. Im Board ist damit ablesbar, wie weit die Prüfung ist, ohne Body oder Kommentare zu öffnen.

**Der Default ist `false`.** Ein Kit-Update darf Bestandsprojekten nicht ungefragt Labels in ihre Boards schreiben; wer das Verfahren einführt, schaltet es bewusst ein — und legt vorher die Definitionen an (siehe unten).

Vier Zustände, abgeleitet aus Body und Kommentaren:

| Zustand | Woraus abgeleitet | Label |
|---|---|---|
| `fertig` | Marker der eigenen Stufe gesetzt, **oder** gültiger `Pruefung: Verzicht` | `review:fertig` |
| `befunde` | jüngster Review-Kommentar der Stufe, ohne Ausfallvermerk | `review:befunde` |
| `ausgefallen` | jüngster Review-Kommentar der Stufe **mit** Ausfallvermerk in Zeile 2 | `review:offen` |
| `offen` | nichts von alledem | `review:offen` |

`ausgefallen` ist der einzige Zustand, dessen Label anders heißt: Ein ausgefallener Reviewer ist **kein Prüfergebnis** — das Ticket ist so ungeprüft wie zuvor. Der Zustand steht trotzdem eigenständig da, weil er für den Menschen etwas anderes bedeutet als „noch nicht angefangen".

Ein Marker einer **fremden** Stufe zählt nie: `Plan-Review:` an einem Arbeitspaket ist kein Nachweis. Marker in Codeblöcken zählen ebenfalls nicht — ein Dokument, das das Format als Beispiel zeigt, weist damit nichts nach.

#### `review:*` beschreibt, `kit:klaeren` entscheidet

Die beiden Labelsorten sehen ähnlich aus und leisten Verschiedenes:

- **`review:*` beschreibt.** Es ist eine Projektion des abgeleiteten Zustands, jederzeit neu berechenbar. Kein Gate liest es: `requiredBeforeReady` hängt am Marker, die Kandidatenauswahl des Nacht-Runners an Marker und Routing-Label. Ein von Hand verstelltes `review:*` repariert der nächste `label-sync` von selbst.
- **`kit:klaeren` entscheidet.** Es sagt, dass eine Frage offen ist, die ein Mensch beantworten muss. Der Nacht-Runner **setzt** es, aber **nimmt es nie ab** — ein Lauf, der sein eigenes `kit:klaeren` abräumen dürfte, könnte sich selbst freigeben. Solange es steht, wird das Ticket weder implementiert noch erneut geprüft.

Kurz: Ein `review:*` von Hand zu entfernen ist folgenlos, ein `kit:klaeren` von Hand zu entfernen ist die Antwort.

#### Die Klassifikation der Funde

Jeder Reviewer-Fund trägt neben dem Schweregrad eine Klasse. Sie entscheidet, ob die Maschine ihn anwenden darf:

| Klasse | Bedeutung | Folge |
|---|---|---|
| `korrektur` | plausibel, wichtig, **ein** Weg | wird angewendet |
| `gate` | Verstoß gegen eine Registerregel | ruft den Menschen, `kit:klaeren` |
| `alternativen` | mehr als ein gangbarer Weg | ruft den Menschen, `kit:klaeren` |

Die Register, gegen die `gate` gemessen wird, sind zwei: `CLAUDE-workflow.md` führt die prozessweiten Gates (Stop-Punkte, Git-Workflow, Pflichtchecks, Prioritäten), `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md` die Formregeln ihrer Stufe. Für die Stufe `issue` gibt es kein eigenes Formregister; dort zählt allein das prozessweite.

`gate` und `alternativen` kann die Synthese **nicht verwerfen** — verworfen wird nur, was nicht plausibel oder nicht wichtig ist.

#### Einrichtung: die vier Definitionen je Board

Die Labels müssen am Board **definiert** sein, bevor `statusLabels` eingeschaltet wird. Fehlt eine Definition, scheitert der erste `label-sync` hart; der Adapter übersetzt den 404 des Servers in einen Hinweis, der den fehlenden Namen nennt.

Anzulegen sind vier: `review:offen`, `review:befunde`, `review:fertig` und `kit:klaeren`. Die Namen sind **fest und nicht konfigurierbar** — konfigurierbare Namen wären eine zweite Wahrheit und zerstörten die Wiedererkennbarkeit über Projekte hinweg.

- **kanban-kit:** `POST /api/boards/{boardId}/labels`. Über `/api/kanban` gibt es dafür keinen Weg — das ist der einzige Einrichtungsschritt, den keine Session erledigen kann.
- **GitHub:** `gh label create review:offen` und so fort.
- **GitLab:** `glab label create` bzw. die Label-Verwaltung des Projekts. **Achtung:** Bei GitLab sind Spalten selbst Labels. Kollidiert einer der drei Namen mit einem konfigurierten Spalten-Label, bricht `label-sync` ab, statt die Spaltenlogik zu beschädigen.

### Prüfumfang am Ticket: Vorgabe, Verzicht, Verfall

Nicht jedes Arbeitspaket verdient denselben Aufwand. Ein Einzeiler mit offensichtlichem Kriterium braucht keine Runde durch ein fremdes Modell, ein architekturnahes Paket vielleicht zwei. Das entscheidest du am einzelnen Ticket — und ein Arbeitspaket steht deshalb in einem von **drei Zuständen**:

| Zustand | Woran erkennbar | Was `/implement-next` und der Nacht-Runner tun |
|---|---|---|
| geprüft | Marker `Issue-Review: …`, im Umfang der Vorgabe bzw. des Regelfalls | umsetzen, kein Hinweis |
| bewusst ohne Prüfung freigegeben | gültige Zeile `Pruefung: Verzicht` | umsetzen und das im Bericht vermerken — keine Rückfrage |
| noch nicht geprüft | weder Marker noch gültiger Verzicht | interaktiv nachfragen, nachts bei `requiredBeforeReady` zurückstellen |

Der mittlere Zustand ist der neue: Ein Verzicht ist **keine Lücke**, sondern eine Entscheidung. Ihn zur Rückfrage zu machen hieße, ihr zu widersprechen — deshalb ist er der zweite Freigabegrund am Gate, gleichwertig zum Marker.

**Zwei Zeilen, zwei Besitzer.** Beide stehen im `## Kontext` des Arbeitspakets und sehen sich zum Verwechseln ähnlich. Geschrieben werden sie von verschiedenen Seiten:

- `Pruefung: <1|2|3|Verzicht>` — **setzt der Mensch**. Die Zahl ist die Zahl der Review-Runden, `Verzicht` heißt: ohne Prüfung freigegeben. Ohne die Zeile gilt der Regelfall aus `issueReview.rounds`.
- `Pruefung-Stand: <hex>` — **schreibt die Maschine**: `issue update` setzt sie beim Speichern unter die Vorgabezeile. Von Hand anfassen entwertet die eigene Vorgabe, ohne dass eine Fehlermeldung darauf hinweist.

So sieht ein Arbeitspaket aus, das du bewusst ohne Prüfung freigibst:

```markdown
## Kontext

Autor-Modell: claude-opus-5
Pruefung: Verzicht
Pruefung-Stand: 4f2b8e1c…

Die Fußzeile nennt noch die alte Domain.

## Aufgabe

`src/footer.html`: `example.org` durch `example.com` ersetzen.

## Akzeptanzkriterium

- Kein Vorkommen von `example.org` mehr im Repository.

## Abhängigkeiten

Keine.
```

Getippt hast du davon **eine** Zeile: `Pruefung: Verzicht`. Die Standzeile darunter kam beim Speichern durch `issue update` dazu — der Hash ist hier gekürzt, echt sind es 64 Hex-Zeichen. Ab jetzt gilt: Solange Aufgabe, Akzeptanzkriterium und Abhängigkeiten so bleiben, setzt der Nacht-Runner das Paket um, ohne es zurückzustellen. Schreibst du ein zweites Akzeptanzkriterium dazu, passt der Stand nicht mehr, und es gilt wieder der Regelfall.

Was tatsächlich gilt, lässt sich ablesen statt ausrechnen — die Felder `verzicht` und `vorgabeQuelle` (`issue` · `verfallen` · `config`) sagen es:

```bash
node .claude/kit/board.mjs issue-review roles --stufe issue --author claude-opus-5 --issue 307
```

**Der Verfall.** Der Stand ist ein SHA-256 über den Body **ohne** den Kontext-Abschnitt — also über Aufgabe, Akzeptanzkriterium und Abhängigkeiten samt allem Weiteren außerhalb des Kontexts. Ändert sich dort etwas, passt der gespeicherte Stand nicht mehr: Die Vorgabe ist verfallen, und es gilt wieder der Regelfall, bis du neu entscheidest. Das ist der Sinn der Zeile — eine Freigabe „das braucht keine Prüfung" gilt für die Aufgabe, die du gelesen hast, nicht für die, die danach hineingeschrieben wurde.

Der Kontext-Abschnitt zählt dabei bewusst nicht mit, denn dort stehen die Kennzeichnungszeilen selbst — `Autor-Modell:`, `Issue-Review:`, die Vorgabe. Zählte er mit, wäre jede Markierung ihr eigener Verfall. Eine Ausnahmeliste einzelner Zeilen wäre die Alternative gewesen, und sie wäre dauerhafter Pflegeaufwand: Wer künftig eine Kennzeichnungszeile einführt und sie dort vergisst, erzeugte stillen Verfall.

**Fehlt der Stand, gilt die Vorgabe.** Eine `Pruefung:`-Zeile ohne `Pruefung-Stand:` — etwa weil sie im Board-UI von Hand gesetzt wurde und nie ein `issue update` lief — ist voll wirksam. Ohne Bezugsstand lässt sich kein Verfall feststellen, und im Zweifel gilt die Entscheidung des Menschen und nicht ihre Annullierung durch eine fehlende Zeile.

**Die Grenze der Human-only-Regel.** Eine Verringerung — `Verzicht` oder ein Wert unter dem Regelfall — weist der Adapter ab, sobald `KIT_AGENT_MODEL` gesetzt ist. Das trifft genau den unbeaufsichtigten Lauf: Der Nacht-Runner setzt die Variable, und der Nacht-Review schreibt den geschärften Body selbst — ohne die Regel könnte er sich die eigene Prüfung wegschreiben. Seit die Schärfung auf allen drei Stufen schreibt, greift dieser Schutz gerade bei `fachlich` und `plan`: Dort steht die Vorgabe des Menschen in einem Dokument, das die Maschine nun ebenfalls anfasst. Eine interaktive Session hat die Variable nicht: Wenn du ihr sagst, sie solle `Pruefung: Verzicht` eintragen, trägt sie es ein. Das ist Absicht — sie handelt dann als verlängerter Arm des Menschen, der danebensitzt. Die Regel schützt vor unbeaufsichtigter Selbstfreigabe, nicht vor dir.

### Was es kostet

Jeder Prüfer ist ein zusätzlicher Lauf. Seit die Prüfung nach oben gewandert ist, kostet ein Plan mit dreizehn Arbeitspaketen 17 Läufe statt 26 — zweimal Anforderung, zweimal Plan, dann je einmal pro Paket. Das Verfahren lohnt sich bei Issues, die etwas kosten, wenn sie falsch sind — nicht bei jedem Einzeiler. Deshalb ist es opt-in: Ohne Argumente nimmt der Skill die ungeprüften Dokumente aus dem Backlog, mit Nummern genau die genannten (siehe [Welche Dokumente drankommen](#welche-dokumente-drankommen)).

`rounds` bleibt bei 1. Weitere Runden finden erfahrungsgemäß vor allem Geschmacksfragen; wenn eine zweite Runde nichts mehr mit Schweregrad BLOCKER oder WICHTIG liefert, sagt der Skill das.

## Team-Config und persönliche Abweichungen

Dieselbe Frage wie oben, eine Ebene tiefer: Was gehört ins Repository, und was darf jeder für sich anders haben?

`.claude/workflow.config.json` lag bisher außerhalb des Repositories — der Installer trug `.claude/` in die `.gitignore` ein. Damit hatte jedes Teammitglied seine eigene Fassung der Felder, die für alle gleich sein müssen. `buildChecks` entscheidet, was als grün gilt; `columns` entscheidet, wo Issues landen. Und eine abweichende `columns`-Fassung führt nicht zu einem Fehler, sondern zu einer leeren Issue-Liste — das ist der unangenehme Teil.

Die Config besteht deshalb aus zwei Dateien:

| Datei | Ort | Inhalt |
|---|---|---|
| `.claude/workflow.config.json` | **im Repository** | alles, was für das Team gilt |
| `.claude/workflow.config.local.json` | lokal, gitignored | persönliche Abweichungen |

Aus der lokalen Datei gewinnen nur diese Felder:

| Feld | Warum persönlich |
|---|---|
| `reviewModel` | Modellwahl fürs Review ist Geschmack und Budget |
| `reviewScope` | manche lesen lieber den vollen Quelltext |
| `triggers` | Tippgewohnheit für die drei Stop-Phrasen |
| `toolbox.tokenFile` | zeigt auf ein Token im eigenen Dateisystem |

Alles andere wird ignoriert und auf stderr gemeldet.

**Warum die Härte?** Wäre `buildChecks` lokal überschreibbar, könnte sich jeder sein Gate wegkonfigurieren, und die Trennung wäre Kosmetik statt Leitplanke. Der naheliegende Einwand — man kann die geteilte Datei ja trotzdem lokal editieren — stimmt, trifft aber nicht: Dann steht sie in `git status`. Sichtbare Abweichung ist etwas anderes als per Design unsichtbare.

Der `.gitignore`-Block, den der Installer schreibt:

```
.claude/*
!.claude/workflow.config.json
.claude/workflow.config.local.json
.claude/board-meta-cache.json
```

Die erste Zeile muss `.claude/*` lauten, **nicht** `.claude/`. Git wertet ein `!`-Negationsmuster nicht aus, wenn das Verzeichnis selbst ausgeschlossen ist — es betritt es gar nicht erst. Mit `.claude/` bliebe die Ausnahme wirkungslos, und der Fehler fühlt sich an wie „vergessen zu committen". Wer den Block von Hand schreibt, baut ihn genau einmal falsch und sucht lange.

**Bestehende Projekte:** Der nächste `install.mjs`-Lauf ersetzt eine vorhandene `.claude/`-Zeile automatisch durch den Block; eigene `.claude`-Regeln bleiben unangetastet und der Installer gibt nur eine Empfehlung aus. Danach muss ein Mensch `.claude/workflow.config.json` einmal committen — der Installer kann das nicht für dich tun.

## Eine Datei, ein Schreiber

Dasselbe Prinzip, angewandt auf das Gedächtnis statt auf den Code: **Jede Datei im Memory-Vault, in die ein Skill automatisch schreibt, gehört genau einem Repo.** Was geteilt wird, wird gelesen — oder nur nach ausdrücklicher Zustimmung geschrieben.

Der Anlass ist ein Setup mit mehreren Repos an einem gemeinsamen Vault, etwa fünf Microservices. Geteilt werden soll das Wissen, nicht die Schreibhoheit. Solange alle Sessions eines Tages in dieselbe Log-Datei schreiben, entstehen in einem synchronisierten Vault Konflikt-Kopien, und bei parallelen Sessions überschreibt die zweite den Abschnitt der ersten. Beides fällt spät auf, weil niemand seinen Tageslog noch einmal liest.

Zwei Konsequenzen ziehen sich daraus durch das Kit:

- **Der Tageslog wird projektspezifisch.** Das Feld `logPath` macht den Dateinamen konfigurierbar (`Log/{date}-{project}.md`), damit jedes Repo seine eigene Datei bekommt. Das gilt nicht nur für Microservices: **Sobald zwei beliebige Projekte denselben Vault benutzen, gehört `logPath` gesetzt** — der Default `Log/{date}.md` ist eine Datei pro Tag, nicht pro Projekt. Details in der [`kontext.config.json`-Referenz](kontext-config-reference.md).
- **Die gemeinsame Dach-Notiz schreibt `/document` nie von selbst.** Sie ist der einzige geteilte Schreibort und deshalb bewusst nicht automatisiert: Nur bei Cross-Service-Wirkung fragt der Skill einmal nach, mit dem konkreten Eintragstext, und schreibt erst nach Zustimmung. Sonst wäre die Konfliktfläche nur vom Log in die Notiz verschoben.

Der Unterschied zum Leitplanken-Prinzip oben ist die Art des Stopps: Dort scheitert ein Gate mechanisch, hier fragt ein Skill einen Menschen. Der Grund ist derselbe — die Entscheidung, ob eine systemweite Erkenntnis in die gemeinsame Notiz gehört, kann keine Regel treffen.

## Was bewusst nicht im Kit ist

**Security-Gates gehören ins CI, nicht in einen Skill.** gitleaks findet Secrets, Semgrep oder SpotBugs finden SQL-Konkatenation und fehlende Input-Validation. Ein deterministisches Tool teilt mit keinem Sprachmodell einen blinden Fleck. Ein roter Build blockiert den Push mechanisch, verlässlicher als jedes Modell. Der Review-Skill ergänzt diese Tools, ersetzt sie nicht.

**Kein Multi-Tool-Adapter.** Das Konzept ist übertragbar, das Format nicht. Codex liest `AGENTS.md`, Cursor `.cursor/rules`. Wenn du mehrere Engines einsetzen willst, brauchst du die Skill-Bibliothek in mehreren Formaten parallel im Repo. Das ist machbar, aber nicht Bestandteil dieses Kits.

## Issue-Tracker und Code-Host

Das Kit unterstützt GitHub, GitLab und einen vollständig lokalen Modus. Die Wahl erfolgt über zwei unabhängige Achsen: `codeHost` (für Pull Requests und Repo-Erkennung) und `issueTracker` (für Issues und Board-Bewegungen). Beide können auf verschiedene Plattformen zeigen.

### Tracker-Wechsel dieses Repositories: kanban-kit und GitHub-Archiv

Seit dem 11. August 2026 führt dieses Repository seine Issues in **kanban-kit**, nicht mehr in GitHub. Der Adapter- und Configwert dafür lautet `issueTracker: "toolbox"`; `kanban-kit` ist der Produktname und kein gültiger Wert. Der Code-Host bleibt `codeHost: "github"`.

**GitHub Issues bleiben aktiviert.** Sie werden nicht mehr für neue Arbeit verwendet, aber sie sind das Archiv: Die beim Umzug bereits geschlossenen 218 Issues sind dort geblieben, und bestehende Commit-Botschaften mit `#N` behalten dadurch ein erreichbares historisches Ziel. Wer das Issue-System dort abschaltet, nimmt der Commit-Historie ihren Bezugspunkt.

**Nummernlücken im kanban-kit sind gewollt.** Migriert wurden ausschließlich die zum Stichtag offenen Issues, mit ihren Originalnummern. Die Lücken dazwischen haben zwei Ursachen: geschlossene Issues, die nicht mitwanderten, und Pull-Request-Nummern, die sich denselben Nummernraum mit den Issues teilen. Zwischen `#164` und `#247` etwa liegen 70 geschlossene Issues und 12 PRs, aber kein einziges offenes Issue.

**Migrierte Karten sind erkennbar.** Sie tragen `externalKey: github#N` und im Body eine zweizeilige Herkunfts-Kopfzeile, die Quelle und ursprüngliche Spalte nennt:

```
> Quelle: https://github.com/<owner>/<repo>/issues/<N>
> Ursprüngliche Spalte: <Spaltenname oder keine>
```

Die Kopfzeile nennt die Spalte auch dann, wenn kanban-kit sie nicht kennt. Das GitHub-Board führte eine sechste Spalte `Zurückgestellt`, die auf `BACKLOG` abgebildet wurde; ohne die Kopfzeile sähen diese Karten im Backlog aus wie normale Arbeit.

**Der Nummernzähler beginnt oberhalb des alten Nummernraums.** Beim Umzug stand die höchste je vergebene GitHub-Nummer bei 296, `next_card_number` wurde auf 298 gesetzt. Der Zähler darf nie unter diesen Startwert zurückgesetzt werden: Sonst bekäme eine neue Karte eine Nummer, die auf GitHub bereits vergeben ist, und `#150` bezeichnete zwei verschiedene Dinge.

**`tools/migrate-issues.mjs`** war das Werkzeug des Umzugs und bleibt für Nachzügler nützlich. Es hat drei Läufe: `export` (liest GitHub), `import` (schreibt kanban-kit, idempotent über `externalKey`) und `verify` (vergleicht beide Seiten als Gate). Teil des laufenden Workflows ist es nicht — für neue Arbeit legt `/issues` direkt in kanban-kit an.

### Ein einzelnes GitHub-Issue nachträglich überführen

Der Normalfall nach einem Umzug: Jemand von außen meldet einen Bug auf GitHub, weil das Repository dort öffentlich ist. Das Issue soll in kanban-kit, ohne dass der Melder verlorengeht.

```bash
node tools/migrate-issues.mjs export
```

```bash
node tools/migrate-issues.mjs import --file <exportdatei> --from 302 --to 302 --yes
```

`--from N --to N` mit derselben Nummer holt genau ein Issue. Was dabei erhalten bleibt und ein Copy-Paste nicht leistet:

- Der **Quellverweis** steht als Kopfzeile im Body (`> Quelle: …`), die GitHub-Diskussion bleibt also erreichbar.
- Die **Kommentare** wandern mit, jeweils mit Autor und Datum. Bei einem Fremdreport ist genau das der Wert — der Wortlaut des Melders bleibt lesbar.
- Der Import ist **idempotent** über `externalKey`: Ein zweiter Lauf legt nichts doppelt an.
- Die **Originalnummer** bleibt. Verweise aus Commit-Botschaften zeigen weiterhin auf dasselbe Ticket.

Zwei Einschränkungen. `export` liest **alle** offenen Issues, nicht nur das gewünschte — einen Filter auf der Export-Seite gibt es nicht. Und vor dem allerersten `--yes`-Lauf eines Projekts verlangt das Werkzeug einen vollständigen `--dry-run`; in einem Repo, das den Umzug hinter sich hat, ist diese Bedingung erfüllt.

Wenn Nummer und Kommentare nicht zählen, geht es auch ohne das Werkzeug: `gh issue view <N> --json title,body` lesen und den Body per `board.mjs issue create --body -` anlegen. Dann fehlt allerdings der Quellverweis, und wer später wissen will, wer das gemeldet hat, findet es nicht mehr — bei einem Fremdreport ist das der falsche Weg.

### Voraussetzungen je nach Konfiguration

| Wert | CLI | Authentifizierung |
|------|-----|-------------------|
| `github` | `gh` (GitHub CLI) | `gh auth login` |
| `gitlab` | `glab` (GitLab CLI) | `glab auth login` |
| `local` | keine | keine |

### Board-Adapter

Alle Board-Operationen laufen über `.claude/kit/board.mjs`. Der Adapter hat zwei Hauptbereiche:

- **Issue-Tracker-Interface:** `issue create`, `issue list`, `issue get`, `issue move`, `issue comment`, `issue epics`
- **Code-Host-Interface:** `code repo-name`, `code pr`

**`issue list` liefert Arbeitspakete, `issue epics` liefert Vorhaben.** Die Trennung ist scharf: Vorhaben erscheinen in `issue list` nie, auch nicht ohne Status-Filter. Sie sind Klammern über mehreren Karten, keine Arbeit — wer sie in einer Liste offener Issues mitzählt, hält sie für Arbeitspakete mit dünner Beschreibung. `issue epics` liefert sie mit Kürzel und Fortschritt (`#360 [HER] … 8/8`), also mit der Information, die ein Vorhaben tatsächlich trägt.

**Ein Vorhaben hat keinen Status.** `issue get` liefert darauf `status: null`, nicht `backlog`. Der Grund liegt im Server: Er lässt ein Vorhaben per `move` gar nicht auf dem Board positionieren („Epics werden nicht auf dem Board positioniert"). Ein Status, den kein `move` je ändern kann, wäre eine Behauptung über etwas, das es nicht gibt; `null` heißt „hat keinen".

Vorhaben kennen nur die Tracker **local** und **toolbox**. Bei **github** und **gitlab** weist `issue epics` mit einer Meldung ab, die beide fähigen Tracker nennt — dort ist der Fehlschlag der Normalfall, und Aufrufer wie `/kontext` überspringen ihn still.

Die Skills rufen ausschließlich den Adapter auf — sie wissen nichts von `gh` oder `glab`. Du kannst `issueTracker` und `codeHost` jederzeit in der Config ändern; alle Skills passen sich beim nächsten Aufruf an.

**Abarbeitungsreihenfolge = Board-Reihenfolge.** `issue list --status <spalte>` liefert die Issues in der Reihenfolge der Board-Spalte (oben zuerst), nicht numerisch — du steuerst die Abarbeitung von `/implement-ready` also per Drag&Drop in der Ready-Spalte. Umgesetzt pro Tracker: GitHub über die manuelle Projekt-Reihenfolge von `gh project item-list` (gilt für die Standard-Board-View; eine View mit eigener Sortierung zeigt anders an, als die API liefert), GitLab über `--order relative_position`, das eigene Kanban über die Spalten-Position der API. Zwei bewusste Ausnahmen: der lokale Datei-Tracker kennt keine Positionen und bleibt numerisch, und `issue list` ohne Status-Filter bleibt überall stabil numerisch (eine spaltenübergreifende Board-Reihenfolge gibt es nicht). Konsequenz: Die Abarbeitungsreihenfolge hängt am Board-Zustand und ist nicht mehr deterministisch-numerisch — das ist gewollt.

#### Herkunft am Board: `--derived-from`

`issue create` nimmt optional `--derived-from <nummer>` entgegen und schickt die **projektweite Kartennummer** des **nächsten Vorfahren** als Feld `derivedFrom` mit. Damit kennt das Board die Kette Fachplan → Plan → Arbeitspaket als Daten und muss sie nicht aus Beschreibungstexten zusammensuchen.

Gesetzt wird immer nur **ein** Verweis, der auf die nächsthöhere Stufe — der Rest ergibt sich durchs Weiterlaufen der Kette. Wer sie setzt:

| Skill | Verweis |
|---|---|
| `/fachplan` | **nie** — die fachliche Anforderung ist die Wurzel und hat keinen Vorfahren |
| `/plan` | auf das `[Fachlich]`-Issue, wenn der Plan aus `/plan #N` entstand; beim Plan aus dem Chat gar keiner |
| `/issues` | auf das `[Plan]`-Issue, ersatzweise auf das fachliche Issue, sonst gar keiner |

Die Form prüft der Adapter vor jedem Netzaufruf: Was keine positive Ganzzahl ist, endet mit Exit 1 — ausdrücklich auch das **nackte Flag** ohne Wert, das sonst als `1` durchginge. Ob die Nummer existiert, auf die Karte selbst zeigt oder einen Zyklus schließt, prüft der Server; die Obergrenze ist ebenfalls seine Sache und wird hier bewusst nicht nachgebaut.

**Nur `kanbancompat` wertet das Feld aus.** GitHub, GitLab und local nehmen die Option ohne Fehler an und übertragen sie nicht — kein Abbruch, keine veränderte Ausgabe. Ein Skill kann sie deshalb unabhängig vom eingestellten Tracker setzen.

**Die Option wirkt nur beim Anlegen.** Ein Nachtragen gibt es nicht: Eine board-lose Pool-Idee ist für den Adapter unerreichbar (kein `get`, kein `comment`, kein `update`), und ein wiederholter Ingest auf dieselbe Karte verwirft den Wert.

#### Die Luecke: ein Tracker ohne das Feld schweigt

Läuft der Aufruf gegen eine Instanz, die `derivedFrom` noch nicht kennt, wird der unbekannte Schlüssel **stillschweigend** ignoriert: Der Aufruf endet mit **Exit 0**, die Karte entsteht, und die Herkunft fehlt — ohne Fehler, ohne Warnung, ohne Unterschied in der Ausgabe.

**Das ist bekannt und wird bewusst nicht abgesichert.** Die naheliegende Absicherung wäre ein Echo: nach dem Anlegen zurücklesen und prüfen, ob der Wert angekommen ist. Genau das scheitert am wichtigsten Fall — eine board-lose **Pool-Idee** ist nicht lesbar, ihre Antwort trägt kein Echo. Eine Absicherung, die dort nicht greift, wäre schlechter als eine benannte Lücke: Sie erzeugte Vertrauen, das im entscheidenden Fall nicht trägt.

Praktisch heißt das: **Ein erfolgreicher `issue create` ist kein Beleg dafür, dass die Herkunft gesetzt wurde.** Wer das sicher wissen will, liest die Karte am Board nach — sofern sie eine Nummer hat.

#### Warum die Body-Zeilen daneben stehen bleiben

Die Herkunft steht doppelt: als Feld am Board und als Zeile im Body (`Plan: Issue #M`, `Fachliche Quelle: Issue #N`, beide im Kontext-Abschnitt). Das ist keine Dopplung, sondern zwei verschieden haltbare Formen.

Das Feld ist die **abfragbare** Form — das Board gruppiert danach, ohne Bodies zu zerlegen. Die Zeilen sind die **dauerhafte**: Ein **Projektwechsel löscht die Herkunft** am Board, und zwar in beide Richtungen — die der verschobenen Karte und die aller Karten, **die auf sie zeigen**. Grund ist die Eindeutigkeit der Nummern: Sie werden projektweit vergeben, ein übernommener Verweis zeigte nach dem Umzug auf eine fremde Karte. Die Body-Zeilen überleben das, weil sie Text sind.

Dazu kennen `github`, `gitlab` und `local` gar kein solches Feld. Wer die Zeilen später als redundant streicht, verliert die Herkunft beim ersten Umzug — und in drei von vier Trackern sofort.

#### Herkunft auswerten: derived-from-report

`tools/derived-from-report.mjs` liest die Body-Zeilen zurück und weist für jede Karte aus, welchen Verweis sie bekäme — als Vorbereitung einer möglichen Nachpflege des Bestands. Die Karten kommen über stdin, das Werkzeug holt sie nicht selbst:

```bash
node .claude/kit/board.mjs issue list | node tools/derived-from-report.mjs
node .claude/kit/board.mjs issue list | node tools/derived-from-report.mjs --json
node tools/derived-from-report.mjs --help
```

Ohne Flag entsteht eine lesbare Zusammenfassung mit einem Zähler je Zustand und einer Liste der Karten, die Aufmerksamkeit brauchen. `--json` gibt dieselben Daten roh aus, damit eine spätere Migration sie verarbeiten kann. Dass die Karten gereicht statt geholt werden, hat drei Gründe: Es ist ohne Mock-Server testbar, es funktioniert für **jeden** Tracker statt nur für kanbancompat, und derselbe Schnappschuss lässt sich zweimal auswerten.

**Das Werkzeug schreibt nichts** — weder ans Board noch ins Dateisystem. Es ist ein Trockenlauf und bleibt einer, solange es keinen **Schreibpfad** für `derivedFrom` gibt: Das Feld wird beim Anlegen gesetzt und danach nie geändert. Ob und wie der Bestand nachgepflegt wird, hängt an einer Entscheidung im Projekt kanban-kit und liegt als Idee **#355**.

**Wo gesucht wird, hängt am Dokumenttyp** — sonst wirkt der Zustand `fehlplatziert` willkürlich:

| Dokument | gültiger Fundort |
|---|---|
| Arbeitspaket | Abschnitt `## Kontext` |
| `[Plan]`-Dokument | Kopfbereich vor `## Ziel`, also vor der ersten `##`-Überschrift |

Plandokumente haben gar keinen Kontext-Abschnitt; ein Leser, der nur ihn kennt, übersähe jede Zwischenstufe der Kette. In beiden Fällen zählen nur Zeilen **außerhalb von Code-Fences** — ein Issue, das die Konvention als Beispiel zeigt, darf keinen Verweis erfinden.

Je Karte entsteht genau ein Zustand:

| Zustand | Bedeutung |
|---|---|
| `vorfahr` | genau ein eindeutiger Verweis, die Zielkarte existiert |
| `keiner` | keine Verweiszeile — die Karte bliebe leer. **Kein Fehler**, sondern der Normalfall für alles, was vor der Konvention entstanden ist |
| `unbekannt` | der Verweis nennt eine Nummer, die es in der übergebenen Kartenmenge nicht gibt |
| `selbstverweis` | der Verweis zeigt auf die eigene Karte |
| `mehrdeutig` | mehrere Zeilen desselben Typs mit verschiedenen Nummern — hier wird nicht geraten |
| `fehlplatziert` | eine Verweiszeile steht außerhalb des gültigen Fundorts, während dort keine steht |

Bei `unbekannt` und `selbstverweis` trägt das Ergebnis zusätzlich das Feld `gelesen` mit der Nummer, auf die gezeigt wurde.

**Wozu das gut ist, zeigte der erste Lauf:** Von 47 Karten mit Verweis waren null fehlplatziert und null mehrdeutig — aber **14 zeigten auf zwei Vorfahren, die es am Board nicht mehr gab**. Eine Migration wäre daran gescheitert, weil der Server unbekannte Nummern beim Anlegen ablehnt. Genau dafür läuft man trocken.

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

**Board-Status per Label.** GitLab bildet die fünf Spalten über Labels ab: `~Backlog`, `~Ready`, `~In progress`, `~In review`, `~Done`. Der Installer legt die Labels automatisch an, wenn du beim Setup "j" bestätigst. Die Board-Ansicht selbst (Issues → Boards → "Add list") musst du einmalig manuell in der GitLab-UI anlegen.

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

### Toolbox (privates Setup)

Kein öffentlich beworbenes Kit-Feature: Toolbox ist ein persönliches Kanban-Tool des Autors (eigenes Backend, eigenes Frontend), das er selbst als Issue-Tracker nutzt. Der Installer fragt nicht danach, und dieser Abschnitt dient in erster Linie dem eigenen Nachschlagen — nicht der allgemeinen Empfehlung.

`codeHost` bleibt davon unabhängig (üblicherweise `github` oder `gitlab`): Toolbox ist nur ein Issue-Tracker, kein Code-Host, Pull Requests laufen weiterhin über die dort konfigurierte Plattform.

```json
{
  "codeHost": "github",
  "issueTracker": "toolbox",
  "toolbox": { "host": "https://toolbox.mwolff.org" }
}
```

**Authentifizierung** läuft über einen persönlichen Kanban-Access-Token (PAT), nicht über den Keycloak-Login der Toolbox-Weboberfläche. Jeder Aufruf trägt den Token im Header `X-Kanban-Token`; er wirkt ausschließlich auf `/api/kanban/**`. Einrichtung des `tbx`-CLI und Token-Verwaltung sind Teil des Toolbox-Projekts selbst, nicht dieses Kits.

`board.mjs` löst den Token über drei Wege auf — die erste Fundstelle gewinnt:

1. **`TBX_TOKEN`** (Umgebungsvariable): höchste Priorität. Praktisch, um ein Token pro Terminal-Session oder pro Aufruf mitzugeben, ohne irgendetwas ins Projekt zu schreiben — so schaltet man z. B. einen ganzen Nachtlauf auf ein eigenes Night-Board um (siehe [Nachtbetrieb](#nachtbetrieb)).
2. **`toolbox.tokenFile`** in der `workflow.config.json`: Pfad (relativ zum Projektverzeichnis) zu einer Datei, die nur das Token enthält. Damit bekommt jede App ihr eigenes, projekt-/board-gebundenes Token. Die Token-Datei gehört in `.gitignore` — eingecheckt wird nur der Pfad, nie das Secret.
3. **Globaler `tbx`-Login** (Fallback, bisheriges Verhalten): Token in der Toolbox-Web-UI erzeugen, `tbx auth login` ausführen. Der Token liegt dann unter `~/.config/toolbox-cli/tokens.json` (überschreibbar per `TBX_CONFIG_DIR`) und gilt für alle Projekte auf dem Rechner, die keinen der beiden anderen Wege nutzen.

**Kein Klartext-Token in die `workflow.config.json`.** Die Config ist eingecheckt und wird geteilt. Steht dort ein `toolbox.token` im Klartext, bricht `board.mjs` mit einer klaren Meldung ab, statt das Secret still zu verwenden — nutze `TBX_TOKEN` oder `toolbox.tokenFile`.

**Beispiel: zweite App mit eigenem Token am selben kanban-kit.** Der Server unterstützt projekt-/board-gebundene Tokens: in der Admin-UI ein zweites Token erzeugen und an Projekt 2/Board 2 binden. Im zweiten Projekt dann entweder `TBX_TOKEN` setzen oder in der Config auf eine gitignorete Token-Datei zeigen:

```json
{
  "codeHost": "github",
  "issueTracker": "toolbox",
  "toolbox": {
    "host": "https://toolbox.mwolff.org",
    "tokenFile": ".claude/tbx.token"
  }
}
```

```bash
echo "<token-aus-der-admin-ui>" > .claude/tbx.token
echo ".claude/tbx.token" >> .gitignore
```

Der globale `tbx`-Login von App 1 bleibt dabei unangetastet — App 1 fällt weiter auf `tokens.json` zurück, App 2 nutzt ihr eigenes Token aus der Datei. Die Host-Auflösung ist davon unabhängig (`toolbox.host` in der Config, sonst der Host aus dem `tbx`-Login).

**Spaltennamen sind fix.** Anders als bei GitHub und GitLab lassen sich die fünf Status (`backlog`, `ready`, `in_progress`, `in_review`, `done`) hier nicht über `columns` in der Config umbenennen — sie werden intern 1:1 auf die Kanban-Spalten `BACKLOG`, `READY`, `IN_PROGRESS`, `IN_REVIEW`, `DONE` der Toolbox abgebildet.

**Neue Issues landen direkt im Backlog.** Gegen ein kanban-kit ≥ 1.5 legt `issue create` die Karte sofort mit ihrer Board-Nummer an — sie steht unmittelbar in der Backlog-Spalte und ist ab da über `#N` adressierbar. Das ist die Vorgabe; ein Projekt muss dafür nichts konfigurieren.

**`ideaStored: true` lenkt stattdessen in den Projekt-Ideen-Pool.** Dann entsteht eine board-lose Idee: Sie erscheint in keiner Spalte, und die Board-Nummer gibt es erst, wenn du sie einplanst. Der Adapter meldet das ehrlich zurück (`ideaId` + `pending: true` statt einer Nummer, mit Hinweistext); eine Response ohne verwertbare Kennung bricht hart ab. Das Einplanen ist bewusst dir vorbehalten — es ist dieselbe menschliche Sichtung wie das frühere Hochziehen aus dem Ideen-Speicher.

Der Schalter heißt in der Config `ideaStored`, das Feld auf der Leitung aber `direct`: Ein fehlendes oder auf `false` gesetztes `ideaStored` sendet `direct: true`, ein `ideaStored: true` sendet gar nichts. Das früher gesendete Wire-Feld `ideaStored` wandert in **keinem** Fall mehr über die Leitung — der Server ignoriert es ohnehin.

Vier Fälle, damit klar ist, was wann passiert:

| Config | Gesendet | Ergebnis |
|---|---|---|
| nicht gesetzt | `direct: true` | Karte im Backlog, mit Nummer |
| `ideaStored: false` | `direct: true` | Karte im Backlog, mit Nummer |
| `ideaStored: true` | kein `direct` | Idee im Pool, `ideaId` + `pending` |
| Legacy-Backend ohne `direct` | egal | wie bisher: Nummer zurück |

Wird direkt angelegt — also im Regelfall —, kommt aber nur eine `ideaId` zurück, bricht `issue create` **ab** statt `pending` zu melden: Sonst sähe der Aufruf erfolgreich aus, während die Karte keine Nummer hat. Die Meldung nennt `ideaStored: true` als Weg in den Pool-Modus. Ältere Backends (Original-Toolbox, kanban-kit vor 1.5) verhalten sich unverändert; GitHub- und GitLab-Tracker sind von alldem nicht betroffen.

## Aktualisieren und mehrere Projekte

Weil die Skills projekt-unabhängig sind und nur die Config projektlokal ist, aktualisierst du das Kit, indem du den Installer erneut laufen lässt. Deine Config bleibt erhalten (der Installer fragt dich, bevor er sie überschreibt).

In einem neuen Projekt brauchst du nur den Installer auszuführen oder die `workflow.config.json` aus einem bestehenden Projekt zu kopieren und die Branch-Namen anzupassen. Alle Skills sind sofort einsatzbereit.

Arbeiten mehrere Projekte gegen denselben Toolbox-/kanban-kit-Tracker, bekommt jedes Projekt sein eigenes, projekt-/board-gebundenes Token: per `TBX_TOKEN`-Umgebungsvariable oder per `toolbox.tokenFile` in der Config (gitignorete Datei, kein Klartext-Token in der geteilten `workflow.config.json`). Precedence und ein Beispiel stehen im Abschnitt [Toolbox (privates Setup)](#toolbox-privates-setup).

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

Die Dateien werden **feldweise gemergt, lokale Felder gewinnen**. Felder, die in der lokalen Config nicht stehen, werden von der globalen geerbt. Wenn keine Config gefunden wird, laufen `/kontext` und `/document` im Degraded Mode.

### Felder

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `vault` | `string` | optional | Absoluter Pfad zum Memory-Vault. Ohne dieses Feld läuft der Skill im Degraded Mode. |
| `always` | `string[]` | optional | Dateien relativ zum `vault`-Root, die immer gelesen werden (z.B. Profil, Arbeitsregeln) |
| `projectDocs` | `string[]` | optional | Dateien oder Glob-Muster relativ zum Projektverzeichnis. Fallback: `["CLAUDE-*", ".claude/CLAUDE-*"]` |
| `project` | `string` | optional | Override für den Vault-Projektnamen, nur nötig wenn Repo-Name und Vault-Ordnername voneinander abweichen |
| `logPath` | `string` | optional | Template für die Tageslog-Datei, relativ zum `vault`-Root. Platzhalter `{date}` und `{project}`. Default: `"Log/{date}.md"` |
| `parentProject` | `string` | optional | Dach-Projekt über mehreren Service-Repos (Multi-Repo-Setup) |

**`logPath` brauchst du, sobald mehr als ein Projekt denselben Vault benutzt** — unabhängig davon, ob die Projekte etwas miteinander zu tun haben. Der Default `Log/{date}.md` ist eine Datei pro **Tag**, nicht pro Projekt: Ohne `{project}` im Template landen alle Sessions eines Tages in derselben Datei, und `kontext last-log` liefert beim nächsten `/document` womöglich den Eintrag eines fremden Projekts als Vorgänger. Zwei unabhängige Repos an einem Vault genügen dafür schon.

`parentProject` ist davon unabhängig und nur für **Multi-Repo-Systeme** gedacht, in denen mehrere Service-Repos zu einem Ganzen gehören (siehe unten). Wer ein Dutzend eigenständiger Projekte an einem Vault führt, setzt `logPath` und lässt `parentProject` weg.

Das vollständige Setup mit Vault-Struktur und Beispiel-Config steht in der [`kontext.config.json`-Referenz](kontext-config-reference.md); das Prinzip dahinter unter [Eine Datei, ein Schreiber](#eine-datei-ein-schreiber).

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

### Pfade prüfen, ohne einen Skill zu starten

Die Zielpfade berechnet der Board-Adapter, nicht der Skill-Prompt:

```bash
node .claude/kit/board.mjs kontext paths
```

Die Ausgabe nennt Tageslog, Projektnotiz und — im Multi-Repo-Setup — die Dach-Notiz, jeweils als absoluten Pfad. Stimmen sie hier, stimmen sie auch im Skill. Der Projektname entsteht in der Reihenfolge `--project` → `project` aus der Config → Repo-Name → Verzeichnisname; weicht der Repo-Name vom Vault-Ordnernamen ab, trägst du den korrekten Namen als `project`-Feld in der lokalen Config ein.

`node .claude/kit/board.mjs kontext last-log` liefert dazu den jüngsten vorhandenen Log-Eintrag desselben Projekts — `/document` knüpft damit an den vorherigen Eintrag an, statt bei null anzufangen.

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
