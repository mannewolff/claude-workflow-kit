# Dokumentation: claude-workflow-kit

Eine dünne Werkzeugschicht, die einen 9-Schritt-Kernprozess für KI-gestützte Entwicklung in Claude Code ausführbar macht. Das Kit automatisiert die KI-Schritte und lässt die drei menschlichen Verantwortungsschwellen bewusst stehen.

## Konzept

Das Kit ist keine Plattform und kein Agent. Es ist eine Bibliothek aus sechzehn Skills, eine projektlokale Config und ein Installer.

Die Skills sind projekt-unabhängig geschrieben. Alles Projekt-Spezifische (Build-Kommandos, Branch-Namen, Review-Modell) kommt aus der Config-Datei. Ein Update an einem Skill gilt damit in allen Projekten, in denen du das Kit nutzt. Du musst nicht in jedem Repo etwas anpassen, wenn sich der Prozess weiterentwickelt.

Der Kernprozess hat neun Schritte. Schritt 1 ist deine Anforderung; die KI übernimmt die Schritte 2, 3, 5, 6 und 7. Die drei menschlichen Stop-Punkte sind Schritt 4 (GO), Schritt 8 (Push) und Schritt 9 (Merge); zwischen Push und Merge prüfst du den Test-Server. Neun weitere Skills stehen außerhalb der Nummerierung und strukturieren den Arbeitsrhythmus: /kontext, /fachplan, /issue-review, /task, /implement-test und /implement-done, /implement-next, /retro und /document.

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

Der Installer stellt neun Fragen — bei globaler Installation folgt eine zehnte:

**1. Global oder projektlokal.** Global legt die Skills in `~/.claude/skills/` ab. Sie stehen dann in allen deinen Projekten zur Verfügung. Projektlokal legt sie in `./.claude/skills/` ab. Sie gehören zum Repo. Für teamverbindliche Prozesse wähle projektlokal, für die persönliche Nutzung global. Bei projektlokal fügt der Installer `.claude/` automatisch in `.gitignore` ein.

**2. Code-Host.** Wo liegen Pull Requests und das Repo? `github`, `gitlab` oder `local` (kein Remote, kein PR).

**3. Issue-Tracker.** Wo werden Issues verwaltet? Standard ist der Wert von Code-Host. Unabhängige Wahl ist möglich, z.B. `issueTracker: local` bei `codeHost: github`.

**4. Name des main-Branch.** In den meisten Repos `main`, manchmal `develop` oder `master`. Dieser Branch ist das Ziel von /push-main.

**5. Name des production-Branch.** Oft `production` oder `release`. /merge-production erstellt einen PR oder MR von main auf diesen Branch.

**6. Review-Umfang (`diff` oder `full`).** Mit `diff` bekommt der Review-Skill nur die geänderten Zeilen zu sehen. Mit `full` alle Dateien im Repo. Für kleine Änderungen reicht `diff`. Für größere Refactorings ist `full` aussagekräftiger, kann aber bei sehr großen Repos das Kontextfenster überlasten.

**7. Review-Modell** und **8. Review-Kommando.** Wer den Code-Review in Schritt 7 fährt — **genau eines von beiden**. Ein Modell (Standard `claude-opus-4-8`) läuft als Subagent; ein Kommando startet ein fremdes Werkzeug und bekommt den Prompt über stdin. Beides zu setzen wird abgewiesen, keines von beidem auch: Sonst liefe Schritt 7 ins Leere. Das gilt für die **Antworten**. Stehen dagegen beide Felder schon **in der Datei**, weist der Installer nicht ab, sondern löst den Widerspruch auf: Er schlägt das vorhandene Kommando vor und sagt vorher, dass das Modell dabei entfällt. Umgekehrt geht es, indem du das Kommando mit `-` leerst und ein Modell einträgst.

**9. Spec-Driven Development (nur projektlokal).** Ob das Projekt unter `specs/` eine Spezifikation seines fachlichen Soll-Verhaltens führt — siehe [Spec-Driven Development](#spec-driven-development). Die Frage erscheint nur bei `issueTracker: toolbox` oder `local` und nur, wenn noch kein `spec`-Block in der Config steht. **Die Entscheidung ist nicht zurückzunehmen**; der Installer sagt das vor der Antwort.

**10. Vault-Pfad (nur bei globaler Installation).** Pfad zum Memory-Vault für /kontext und /document. Leer lassen überspringt den Schritt; mit Pfad schreibt der Installer die globale `~/.claude/kontext.config.json`.

Der Installer kopiert die sechzehn Skills, schreibt eine `.claude/workflow.config.json` mit deinen Antworten, legt eine `CLAUDE-workflow.md` mit der Prozessbeschreibung sowie die beiden Gate-Register `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md` ab und schreibt den Board-Adapter in `.claude/kit/board.mjs`. Bei GitLab fragt er zusätzlich, ob er die fünf Labels automatisch anlegen soll. Kein Hintergrundprozess, kein Service, keine Registry-Einträge.

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

### Das Commit-Gate

Bei projektlokaler Installation fragt der Installer, ob das **Commit-Gate** eingehaengt werden soll. Es weist jeden Commit ab, dem kein gruener `node .claude/kit/checks.mjs run` auf demselben Stand vorausging.

Zwei Dateien tragen es, beide unter `.githooks/` und damit **versioniert**:

| Datei | Rolle |
|---|---|
| `.githooks/pre-commit` | POSIX-sh, wenige Zeilen, delegiert an das Gate |
| `.githooks/gate.mjs` | die Pruefung selbst |

Sie liegen dort und nicht unter `.claude/kit/`, weil der `.gitignore`-Block oben `.claude/*` ausschliesst: Ein frischer Klon haette den Hook sonst ohne das Programm, das er aufruft.

**Was mitwandert und was nicht.** Die Dateien wandern mit dem Klon, die **Aktivierung nicht** — `core.hooksPath` ist lokale git-Config. Wer klont, hat das Gate erst, wenn er den Installer laufen laesst oder `git config core.hooksPath .githooks` selbst setzt.

**Ein belegter `core.hooksPath` wird nicht ueberschrieben.** Faehrt das Projekt Husky oder ein eigenes Hook-Framework, meldet der Installer den gefundenen Wert und aendert nichts — sonst verloere das Projekt mit einem Schreibbefehl alle vorhandenen Hooks. Zum Einhaengen ergaenzt man den eigenen Hook um `node .githooks/gate.mjs pre-commit`. Dasselbe gilt fuer ein bereits vorhandenes `.githooks/pre-commit`, das nicht aus diesem Kit stammt: Es bleibt unangetastet.

**Ausserhalb eines Git-Repos** — und wenn `git` nicht im PATH liegt — entfaellt die Frage; der Installer schreibt die Dateien und sagt, warum das Gate nicht aktiv ist. Bei globalem Install entfaellt sie ebenfalls.

**Was das Gate prüft.** `checks.mjs run` hinterlässt eine Zusammenfassung unter `.claude/checks-summary.json`. Sie trägt neben Auswahl und Ergebnis je geänderter Datei einen **Blob-Hash**, gebildet **vor** dem ersten Kommando — so bezeugt er den Inhalt, der in die Prüfung ging, und nicht einen, den ein Formatter danach geschrieben hat. Beim Commit vergleicht das Gate diese Hashes gegen den **Index**, also gegen das, was wirklich committet wird. Grün nur, wenn die Zusammenfassung lesbar ist, kein Lauf ungrün war und jede gestagte Datei mit passendem Hash darin steht. Eine gestagte **Löschung** ist durch einen `null`-Eintrag gedeckt; hat die Prüfung nichts zu tun gefunden (`leeresPaket`), deckt sie auch nichts.

**Für wen es gilt.** Für jeden Commit im Repo: die Implementierungs-Skills, **Bahn 1**, den Commit von Hand, den aus einem GUI-Client. Ein Werkzeug ohne `node` im PATH wird dabei **abgewiesen**, nicht durchgelassen — ein nicht lauffähiges Gate lässt nicht durch.

**Was es nicht leistet** — vier Grenzen, und sie stehen hier, weil eine Regel, die ihre Lücken verschweigt, falsches Vertrauen erzeugt:

1. `--no-verify` umgeht den Hook. Der Git-Workflow verbietet das, mechanisch verhindert es nichts.
2. Ein frischer Klon hat das Gate erst nach einem Installer-Lauf oder `git config core.hooksPath .githooks`.
3. Bei belegtem `core.hooksPath` hängt ein Projekt mit eigenem Hook-Manager den Aufruf selbst ein.
4. Die Zusicherung gilt **je committeter Datei**, nicht für den Stand als Ganzes: Wer `A` committet und das dazugehörige `B` ungestagt liegen lässt, erzeugt einen Stand, den so nie jemand geprüft hat. Das ist der Preis dafür, dass die Skills selektiv stagen dürfen.

**Was in den Lücken greift.** Läuft der Nacht-Runner, wertet er den Nachweis nachträglich: Fehlt er oder ist er rot, gilt die Runde als Fehlschlag, mit eigenem Board-Kommentar. **Interaktiv greift niemand** — dort bleibt die Regel im Git-Workflow die einzige Sicherung.

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

Der Block `spec` ist hier nicht aufgeführt — er steht bei [Spec-Driven Development](#spec-driven-development).

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

`buildChecks` enthält die Kommandos, die `/local-check` ausführt — die **betroffenen**, ausgewählt nach den Bereichen, die das Arbeitspaket berührt hat (siehe [Bereichsbezogene Prüfungen](#bereichsbezogene-prüfungen-checkareas)); alle ausgeführten müssen grün sein, bevor der Skill Vollzug meldet. Ohne `checkAreas` laufen wie bisher alle. `mutationCommand` ist aus `buildChecks` ausgelagert, weil Mutation Testing deutlich länger läuft (ein leerer String deaktiviert es). `reviewScope` steuert den Umfang für `/review`. `reviewModel` pinnt das Modell über Sessiongrenzen hinweg. `triggers` hält die natürlichsprachlichen Phrasen, falls du lieber tippst als Slash-Befehle nutzt.

**Rückwärtskompatibilität:** Repos, die noch `"provider": "github"` oder `"provider": "gitlab"` in der Config haben, funktionieren weiter. Der Adapter migriert das Feld beim Lesen automatisch auf `codeHost` und `issueTracker`.

Beispiele für verschiedene Stacks:

| Stack | buildChecks | mutationCommand |
|-------|-------------|-----------------|
| Java / Maven | `["mvn verify"]` | `"mvn org.pitest:pitest-maven:mutationCoverage"` |
| Node / npm | `["npm test", "npm run build"]` | `""` |
| Python | `["pytest", "python -m build"]` | `""` |
| Go | `["go test ./...", "go build ./..."]` | `""` |

Du kannst die Config-Datei jederzeit manuell bearbeiten. Der Installer überschreibt sie beim erneuten Ausführen nur, wenn du das explizit bestätigst.

### Bereichsbezogene Prüfungen: `checkAreas`

Ein Arbeitspaket berührt selten das ganze Projekt. Ein `buildChecks`-Eintrag kann deshalb sagen, für welche Bereiche er zuständig ist — dann läuft er nur, wenn einer davon berührt wurde. Ausgewählt und ausgeführt wird von dem mitgelieferten Kommando `.claude/kit/checks.mjs`; die Skills rufen es selbst auf. Du brauchst es nur, wenn du nachsehen willst: `node .claude/kit/checks.mjs plan` zeigt die Auswahl als JSON, ohne etwas auszuführen.

**Die drei Formen eines `buildChecks`-Eintrags:**

```json
{
  "buildChecks": [
    "npx eslint .",
    { "cmd": "npm --prefix frontend run build", "areas": ["frontend"] },
    { "cmd": "mvn verify", "always": true }
  ],
  "checkAreas": {
    "frontend": ["frontend/**"],
    "backend": ["src/main/**", "pom.xml"]
  }
}
```

1. **Der bloße Kommandostring** — nicht zugeordnet, läuft immer. Ein Objekt nur mit `cmd` bedeutet dasselbe.
2. **`{ "cmd", "areas" }`** — läuft, wenn mindestens einer der genannten Bereiche berührt ist. Die Namen stehen in `checkAreas`.
3. **`{ "cmd", "always": true }`** — entschieden immer laufend.

Form 1 und Form 3 verhalten sich gleich und bedeuten trotzdem Verschiedenes: **vergessen** gegen **entschieden**. Wer einen Eintrag als String stehen lässt, hat die Zuordnung vielleicht nur nicht getroffen; wer `always: true` schreibt, hat sie getroffen und sichtbar gemacht. Der Unterschied kostet nichts und trägt die Absicht bis zum nächsten Leser.

`areas` und `always` **schließen sich aus** — eine Vorrangregel für den Fall, dass beide dastehen, würde niemand lesen. `areas` darf außerdem nicht leer sein: Ein leeres Array liefe nie, und eine Prüfung, die nie läuft, gehört gelöscht statt stillgelegt.

**`checkAreas`: Bereichsname → Pfadmuster.** Die Muster kennen `*` innerhalb eines Pfadsegments (`src/*.ts` erfasst keine Unterverzeichnisse) und `**` über Segmentgrenzen hinweg; `/` ist der Trenner, auf den Pfade vorher normalisiert werden — unter Windows also auch die rückwärtigen Schrägstriche. Ein Verzeichnis samt Inhalt erfasst man als `frontend/**`. Die Auswertung bringt das Kit selbst mit: **keine externe Laufzeitabhängigkeit**, wie bei allen ausgelieferten Werkzeugen.

**Zwei Anker — und sie sind verschieden.** Welche Dateien als „berührt" gelten, entscheidet ein Anker: der Git-Stand, gegen den verglichen wird. Die `implement-*`-Skills prüfen **vor dem Commit** gegen den Default `HEAD`; der Diff gegen `HEAD` ist dann genau dieses eine Arbeitspaket, und ein roter Check gehört dem Paket, das ihn ausgelöst hat — auch wenn eine Session mehrfach festschreibt. `/local-check` prüft **vor dem Push** gegen `git merge-base HEAD origin/<mainBranch>` und misst damit alles, was seit dem letzten Push dazugekommen ist, also genau das, was gleich hinausgeht.

Beide Vertauschungen gehen schief, und beide sähen im Bericht korrekt aus. Ein `merge-base`-Anker **vor dem Commit** sammelte fremde Arbeitspakete ein: Ein roter Check spräche dann über Änderungen, mit denen das laufende Paket nichts zu tun hat — nachts würde der Fehlschlag dem falschen Issue zugeschrieben.

Ein `HEAD`-Anker **vor dem Push** sähe umgekehrt auf sauberem Arbeitsbaum gar nichts: Das Kommando meldete `leeresPaket` und ließe jede Prüfung aus, während der Bericht das als vollständigen Lauf auswiese. Deshalb steht in jedem Skill genau ein Anker, und er steht dort begründet.

**Im Zweifel läuft alles. Nicht abschaltbar.** Drei Wege führen zum vollen Umfang: eine geänderte Datei, die sich **keinem Bereich** zuordnen lässt; eine **nicht zugeordnete Prüfung**, die ohnehin immer läuft; und ein **leerer oder nicht auflösbarer Anker**. Ein leerer zählt dabei wie ein nicht auflösbarer, nie wie ein fehlender — ein fehlender ergäbe den Default `HEAD` und auf committetem Stand gar keine Prüfung. Einen Schalter, der die Regel abstellt, gibt es nicht: Eine Auswahl, die falsch ausfällt, nimmt Prüfung weg, und dieser Fehler geht in die Richtung, in der er niemandem auffällt.

Landen häufig Änderungen im Zweifelsfall, ist das ein Befund über die **Zuordnung**, nicht über die Regel: Dann fehlt ein Bereich, oder ein Muster ist zu eng. Die Zuordnung gehört dann verbessert, nicht die Regel aufgeweicht — die Zeit, die eine aufgeweichte Regel spart, zahlt der erste Fehler zurück, den niemand gesucht hat.

**Ohne `checkAreas` ändert sich nichts.** Ein Projekt ohne diesen Block bekommt das Verhalten von vorher, unverändert: Jeder Eintrag ist die String-Form, also nicht zugeordnet, also laufen alle Prüfungen wie bisher. Die Umstellung nimmt niemandem still Prüfung weg — wer die Auswahl will, konfiguriert sie.

**`mutationCommand` bleibt außen vor.** Es steht nicht in `buildChecks` und ist damit **nicht Teil der Auswahl**: Es läuft unverändert immer und direkt, unabhängig davon, welche Bereiche der Anker findet.

Was ausgelassen wurde, bleibt sichtbar: in der Checklist von `/local-check` und im Abschlussbericht am Arbeitspaket, jede Auslassung mit ihrem Grund — und nachts zusätzlich im [Lauf-Bericht des Durchgangs](#nachtbetrieb).

**`stufe` steht auf einer eigenen Achse.** `areas` und `always` sagen, **ob** eine Prüfung betroffen ist; **wann** sie an der Reihe ist, sagt [Gestaffelte Prüfungen](#gestaffelte-prüfungen-stufe).

### Gestaffelte Prüfungen: `stufe`

Nicht jede Pflichtprüfung gehört an jeden Zeitpunkt. Ein Integrationstest, der zwanzig Minuten läuft, nach jedem Arbeitspaket zu fahren, macht die Prüfung vor dem Commit so teuer, dass sie niemand mehr abwartet — ihn wegzulassen macht sie wertlos. Ein `buildChecks`-Eintrag kann deshalb sagen, **wann** er an der Reihe ist:

```json
{
  "buildChecks": [
    "node --test",
    { "cmd": "mvn verify -Pintegration", "stufe": "push" },
    { "cmd": "npm run e2e", "areas": ["frontend"], "stufe": "merge" }
  ]
}
```

| Stufe | Zeitpunkt | Skill |
| --- | --- | --- |
| `paket` | Abschluss eines Arbeitspakets, vor dem lokalen Commit | `/implement-next`, `/implement-ready`, `/implement-done`, `/local-check` |
| `push` | vor dem Veröffentlichen auf `main` | `/push-main` |
| `merge` | vor der Freigabe nach `production` | `/merge-production` |

**Die Stufen sind kumulativ.** `push` fährt die Paketstufe mit, `merge` fährt beide mit — vor der Freigabe laufen also **alle drei**. Keine Prüfung entfällt damit aus dem Prozess; sie läuft nur zu dem Zeitpunkt, an dem ihr Ergebnis zählt. Wer die Freigabestufe fährt, bekommt außerdem den vollen Umfang: Dort wird keine Prüfung mehr nach Bereichen ausgewählt.

**Ein fehlendes Feld bedeutet `paket`.** Die bloße String-Form und ein Objekt ohne `stufe` tragen die Paketstufe, und damit bleibt jede Bestandskonfiguration unverändert in ihrem Verhalten. Wer die Staffelung nicht will, schreibt nichts hin.

**Was später läuft, erscheint als Auslassung** — in der Checklist und im Abschlussbericht, mit ihrer Stufe als Grund. Das ist **kein Mangel, sondern ihr Zeitpunkt**: `Stufe push, gefahren wird paket` heißt, dass diese Prüfung in `/push-main` an der Reihe ist. Oberhalb der Paketstufe nennt das Kommando zusätzlich, was gegenüber ihr hinzukommt (`Stufe push: zusätzlich zur Paketstufe läuft …`) — ein solcher Lauf dauert spürbar länger als der vor dem Commit.

**Mindestens eine Prüfung gehört auf die Paketstufe.** Tragen alle Einträge `push` oder `merge`, läuft vor dem Commit nichts: Die Umsetzung eines Arbeitspakets hat dann kein Gate. Nachts ist das kein stiller Zustand — der Nacht-Runner prüft es beim Start und startet gar nicht erst (Override: `--no-checks-ok`). Die [Einstellungs-Oberfläche](#einstellungen-über-die-oberfläche) meldet diesen Zustand als Warnung; speichern lässt sich eine solche Konfiguration trotzdem, denn gültig ist sie.

**Nicht zu verwechseln.** Der Begriff *Stufe* ist im Kit dreifach besetzt: `reviewStufen` sind die [Prüfstufen des Reviews](#drei-prüfstufen--die-prüfung-wandert-nach-oben), die Aufgabenstufe eines Arbeitspakets (`schwer`/`mittel`/`leicht`) steuert das Modell der [Nacht-Kette](#zweiter-modus-die-nacht-kette), und `stufe` ist der Zeitpunkt einer Pflichtprüfung. Die drei haben nichts miteinander zu tun.

### Gütemessung und Marke: `guete`

Grüne Tests sagen, dass die Tests durchlaufen — nicht, dass sie etwas bemerken würden. **Eine** Prüfung der Liste darf ein Projekt deshalb als **Gütemessung** benennen: Sie misst, wie viele absichtlich eingebauten Fehler die Tests bemerken, und ein Wert unter der vereinbarten Marke hält das Veröffentlichen an. Getragen wird die Benennung von einem `guete`-Block mit `muster` und `marke`:

```json
{
  "buildChecks": [
    "node --test",
    {
      "cmd": "mvn -q org.pitest:pitest-maven:mutationCoverage",
      "stufe": "push",
      "guete": { "muster": "Killed \\d+ \\((\\d+)%\\)", "marke": 80 }
    }
  ]
}
```

**Höchstens ein Eintrag trägt den Block.** Zwei Messungen bräuchten eine Vorrangregel darüber, welche Marke den Halt auslöst, und die läse niemand. Trägt ein Eintrag `guete`, darf seine `stufe` nicht `merge` sein — eine Messung erst vor der Freigabe käme zu spät, um noch etwas zu ändern. Beides weist `checks.mjs` beim Start ab, statt still zu wählen; dieselben Regeln prüft die [Einstellungs-Oberfläche](#einstellungen-über-die-oberfläche) vor dem Speichern.

**Das `muster` ist Pflicht, weil die Werkzeuge Verschiedenes melden.** Es ist ein regulärer Ausdruck mit **genau einer Gruppe**; sie greift den gemessenen Prozentwert aus der Ausgabe des Kommandos:

| Werkzeug | Zeile in der Ausgabe | Muster |
| --- | --- | --- |
| PIT (Java) | `Killed 42 (84%)` | `Killed \\d+ \\((\\d+)%\\)` |
| Stryker (JS/TS) | `Mutation score: 84.21` | `Mutation score: ([\\d.]+)` |

Die erfasste Zahl gilt als Prozentwert, wie die `marke` — eine Einheit, keine zwei. Zulässig sind für die Marke 0 bis 100; eine höhere wäre nie erreichbar. Liegt der gemessene Anteil **auf** der Marke, genügt er.

**Ein Wert unter der Marke ist derselbe Halt wie eine rote Pflichtprüfung** — kein eigener Stop-Punkt, keine Ausnahme, keine persönliche Marke: Die Marke gilt teamweit, eine Abweichung in `workflow.config.local.json` bleibt unwirksam. Ebenso behandelt wird jeder Weg ohne Zahl: ein Muster, das die Ausgabe nicht trifft, ein rotes Kommando, eine Messung, die wegen eines früheren roten Kommandos gar nicht startete. **Ein fehlendes Ergebnis gilt nie als bestandene Prüfung.** Gemessener Anteil, Marke und Grund stehen in der Ausgabe des Prüflaufs und im Abschlussbericht, nachts zusätzlich als eigene Protokollzeile.

**Der Halt kostet keine Arbeit.** Er ist ein roter Lauf **vor Commit und Push**: Die bereits fertigen Pakete bleiben lokal committet, der Versionsbump von `/push-main` bleibt idempotent stehen, und nach der Nachbesserung läuft derselbe Batch weiter.

**Nicht zu verwechseln mit `mutationCommand`.** Das Feld [`mutationCommand`](#mutationcommand) bleibt, was es war: ein dem Build nachgelagertes Kommando, das `/local-check` ausführt und dessen Ergebnis im Bericht landet. Es ist **keine Gütemessung** — es trägt keine Marke, sein Wert wird nicht ausgewertet, und es löst **keinen Halt** aus. Wer die Verbindlichkeit will, führt sein Mutationstest-Kommando als `buildChecks`-Eintrag mit `guete`-Block, wie oben. Beides zugleich zu setzen ergibt zwei Läufe desselben Werkzeugs, von denen nur einer zählt.

**Ohne die Benennung bleibt ein Projekt unberührt:** keine Messung, keine Marke, kein Halt. Wer nichts hinschreibt, merkt von der Gütemessung nichts — auch nicht mit gesetztem `mutationCommand`.

## Einstellungen über die Oberfläche

Statt die Config-Dateien von Hand zu bearbeiten, lassen sich die Prozess-Einstellungen über eine lokale Oberfläche pflegen. Sie wird **nicht installiert**, sondern als einzelne Datei heruntergeladen: [einstellungen.mjs](https://docs.mwolff.org/einstellungen.mjs). Sie arbeitet über alle Projekte unter einem Ordner und gehört deshalb in keines.

```bash
node einstellungen.mjs ~/ki-projects
```

**Welche Projekte erscheinen.** Der angegebene Ordner selbst und jedes direkte Unterverzeichnis, sofern darin `.claude/workflow.config.json` liegt. Ohne Angabe gilt das Arbeitsverzeichnis. Tiefer gesucht wird nicht.

**Die Adresse trägt das Zugangstoken.** Beim Start nennt die Oberfläche eine Adresse der Form `http://127.0.0.1:<port>/#token=…`. Sie ist nur von diesem Rechner erreichbar, und ohne das Token nimmt sie keine Anfrage an — auch nicht von einer anderen Seite im selben Browser. Das Token gilt bis zum Beenden mit Strg+C.

**Sieben Teile.** Die Oberfläche gliedert die Einstellungen in sieben Teile: Reviewer, Paarungen, Prüfstufen, Prüfkommandos und Bereiche, Spezifikation, Nacht-Kette und einfache Gruppen. Änderungen sammeln sich innerhalb eines Teils in einer Arbeitskopie, bis sie gespeichert oder verworfen werden; der Fuß des Teils nennt, wie viele Änderungen offen sind und welche. Bei der Spezifikation gilt das nur für das Einschalten: Ausschalten bietet die Oberfläche nicht an, das Kit nimmt diese Entscheidung nicht zurück.

**Textblock in Dateischreibweise.** Als Textblock in der Schreibweise der Datei bleiben nur zwei Fälle stehen: die Modellliste der Nacht (`night.modelle`) und Einstellungen, die das Kit nicht kennt. Für beide gibt es keinen eigenen der sieben Teile.

**Rückfragen bei Folgen.** Manche Änderung wirkt über ihren eigenen Teil hinaus. Einen Reviewer umzubenennen oder zu entfernen wirkt sich auf die Paarungen aus, einen Bereich umzubenennen oder zu entfernen auf die Prüfkommandos, die ihn nutzen. Eine Rückfrage nennt vorher die betroffenen Stellen; die Folge ist Teil derselben Änderung wie der auslösende Teil und wird mit ihm gespeichert oder verworfen. Eine unabhängige Änderung am betroffenen anderen Teil bleibt davon unberührt.

**Team und persönlich.** Wo eine persönliche Abweichung erlaubt ist, zeigt die Oberfläche den Wert aus `workflow.config.json` (Team), die Abweichung aus `workflow.config.local.json` (persönlich) und den Wert, der gilt. Persönlich speichern lässt sich nur, was das Kit persönlich abweichen lässt (siehe „Team-Config und persönliche Abweichungen"); eine Abweichung lässt sich wieder entfernen. Gespeichert wird nur der geänderte Wert — `git diff` zeigt keine neu formatierte Datei.

**Prüfen vor dem Speichern.** Ungültige Werte, auch solche, die erst im Zusammenspiel mit einer anderen Einstellung ungültig werden, weist die Oberfläche mit Grund zurück. Eine Einstellung, die sie nicht kennt, zeigt sie als Warnung und lässt sie beim Speichern stehen. Wer die Pflichtprüfungen leert oder die Review-Pflicht vor Ready abschaltet, muss das ausdrücklich bestätigen. Hat sich die Datei seit dem Laden geändert, speichert die Oberfläche nicht und fragt, ob die eigene Änderung verworfen oder neu angewendet werden soll.

**Kit-Stand.** Ein Projekt mit einem neueren Kit-Stand als die heruntergeladene Oberfläche — oder ohne erkennbaren Stand — ist nur lesbar; dann hilft eine aktuelle `einstellungen.mjs`.

**Was sie nicht tut.** Sie zeigt keine Einstellungen von Claude Code (Freigaben, Sandbox, Umgebungswerte), legt in einem Projekt ohne Config keine an und prüft nicht, ob eingestellte Kommandos tatsächlich laufen oder Modelle erreichbar sind. Die Textdateien bleiben die Quelle; wer lieber dort arbeitet, kann das weiterhin.

## Alle Einstellungen

<!-- einstellungen:start -->
_Dieser Abschnitt entsteht aus `templates/workflow.config.schema.json` mit `node tools/config-referenz.mjs`; Änderungen gehören ins Schema, nicht hierher._

### `codeHost`

Wo der Code liegt (Push, Pull Requests). Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert. (gültig: `github`, `gitlab`, `local`)

### `issueTracker`

Wo die Issues verwaltet werden. Darf vom codeHost abweichen. 'toolbox' ist ein privates Setup (eigenes Kanban-Tool des Autors), nicht Teil des Installer-Dialogs und nur per manueller Config-Bearbeitung nutzbar. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert. (gültig: `github`, `gitlab`, `local`, `toolbox`)

### `provider`

Veraltet (v1). Wird beim Laden auf codeHost/issueTracker migriert. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert. (gültig: `github`, `gitlab`, `local`)

### `buildChecks`

Kommandos, die /local-check sequenziell ausführt (Build, Tests). Leer-Array = keine automatisierten Checks. Ein Eintrag ist entweder ein Kommandostring oder ein Objekt mit Bereichszuordnung (siehe items und checkAreas). Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `buildChecks[]` — Ein Eintrag hat eine von vier Formen. (1) Der bloße Kommandostring "npx eslint .": nicht zugeordnet, Paketstufe, läuft immer. (2) { "cmd": "...", "areas": ["backend"] }: läuft, wenn einer der genannten Bereiche berührt ist; die Bereichsnamen stehen in checkAreas. (3) { "cmd": "...", "always": true }: entschieden immer laufend. (4) { "cmd": "...", "stufe": "push" }: läuft erst zum genannten Zeitpunkt — ein fehlendes Feld "stufe" bedeutet "paket" und damit unverändertes Verhalten. Form 1 und Form 3 verhalten sich gleich, bedeuten aber Verschiedenes — vergessen gegen entschieden. Ein Objekt nur mit "cmd" bedeutet dasselbe wie die String-Form. "areas" und "always" schließen sich aus (eine Vorrangregel würde niemand lesen), und "areas" braucht mindestens einen Eintrag (ein leeres Array liefe nie). "stufe" steht auf einer eigenen Achse und verträgt sich mit beiden: areas und always sagen, ob eine Prüfung betroffen ist, stufe sagt, wann sie an der Reihe ist. Auf einer dritten Achse steht "guete": Höchstens ein Eintrag der Liste darf den Block tragen, und er sagt, was gemessen wird — nicht ob und nicht wann.
- `buildChecks[].cmd` — Die Kommandozeile, wie sie in der String-Form stünde.
- `buildChecks[].areas` — Bereichsnamen aus checkAreas. Die Prüfung läuft, wenn mindestens einer der Bereiche berührt ist. Nicht zusammen mit "always".
- `buildChecks[].always` — true = entschieden immer laufend, unabhängig von den berührten Bereichen. Nicht zusammen mit "areas".
- `buildChecks[].stufe` — Wann die Prüfung an der Reihe ist: "paket" beim Abschluss eines Arbeitspakets, "push" vor dem Veröffentlichen, "merge" vor der Freigabe. Fehlendes Feld = "paket" = unverändertes Verhalten. Die Stufen sind kumulativ — push fährt paket mit, merge fährt beide mit; keine Pflichtprüfung entfällt damit aus dem Gesamtprozess, sie läuft nur zu dem Zeitpunkt, an dem ihr Ergebnis zählt. Nicht zu verwechseln mit reviewStufen (den Prüfstufen des Reviews) und den Stufen der Nacht-Kette. (gültig: `paket`, `push`, `merge`)
- `buildChecks[].guete` — Benennt diese Prüfung als Gütemessung: Sie misst, wie viele absichtlich eingebauten Fehler die Tests bemerken, und ein Wert unter der Marke hält das Veröffentlichen an. Höchstens ein Eintrag der Liste trägt den Block; trägt er ihn, darf seine "stufe" nicht "merge" sein — eine Messung erst vor der Freigabe käme zu spät, um noch etwas zu ändern. Ohne den Block gibt es weder Messung noch Marke noch Halt; "mutationCommand" ist etwas anderes und löst keinen Halt aus. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.
- `buildChecks[].guete.muster` — Regulärer Ausdruck mit genau einer Gruppe; sie greift den gemessenen Prozentwert aus der Ausgabe des Kommandos. Pflicht, weil die Werkzeuge Verschiedenes melden — PIT schreibt "Killed 42 (84%)", Stryker "Mutation score: 84.21". Die erfasste Zahl gilt als Prozentwert, wie die Marke.
- `buildChecks[].guete.marke` — Der Prozentwert, ab dem die Messung genügt. Liegt der gemessene Anteil darunter, ist der Lauf rot — derselbe Halt wie bei jeder roten Pflichtprüfung, kein eigener Stop-Punkt. Zulässig sind 0 bis 100; eine höhere Marke wäre nie erreichbar.

### `checkAreas`

Benannte Bereiche des Projekts: Schlüssel ist der Bereichsname, Wert eine Liste von Pfadmustern. Auf diese Namen zeigt "areas" in der Objektform eines buildChecks-Eintrags. Im Zusammenspiel der drei Formen: ein bloßer Kommandostring läuft immer (nicht zugeordnet), { "cmd", "areas" } läuft nur, wenn eines der hier hinterlegten Muster berührt ist, { "cmd", "always": true } läuft entschieden immer — String und always:true verhalten sich gleich, bedeuten aber Verschiedenes (vergessen gegen entschieden). Ein Bereich ohne Muster erfasst nichts. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

### `spec`

Schalter für Spec-Driven Development — die Spezifikation des fachlichen Soll-Verhaltens unter specs/. Das Vorhandensein des Blocks bedeutet eingeschaltet — es gibt bewusst kein Feld 'enabled', denn ein Bool hätte einen Aus-Zustand, und die Entscheidung ist nicht zurückzunehmen: Es gibt keinen Weg zurück. Der Zeitpunkt steht in 'seit'; nur Pakete mit einem Anlagedatum ab diesem Tag wertet das spätere Gate. ACHTUNG: Der Block trägt nicht auf jedem Tracker. Bei issueTracker github und gitlab weist spec.mjs jeden Lauf ab — dort gibt es weder Aktivitätsverlauf noch Suche über Aussagen, auf denen Spec-Driven Development aufsetzt. Möglich sind toolbox und local. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `spec.seit` — Ab wann die Spezifikation gilt (JJJJ-MM-TT). Nur Pakete mit einem Anlagedatum ab diesem Kalendertag wertet das spätere Gate; ältere bleiben unberührt.
- `spec.bereiche` — Bereichsnamen auf Code-Globs. Mindestens ein Bereich, und jeder Bereich mindestens ein Muster. Anders als bei checkAreas ist ein leeres Muster-Array hier nicht erlaubt: Dort erfasst ein Bereich ohne Muster nichts und läuft nie, hier wäre er ein Bereich, den das Gate nie zuordnen kann.
- `spec.testPattern` — Regulärer Ausdruck mit dem Platzhalter `<ID>`, der den Verweis auf eine Aussage im Testnamen findet. Fehlendes Feld = der Default.
- `spec.testGlobs` — Pfadmuster, unter denen nach den Tests gesucht wird.

### `mutationCommand`

Kommando für Mutations-Tests (optional). Leer-String oder fehlendes Feld = kein Mutations-Test. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

### `formatFixCommand`

Kommando, das Formatierungsverstöße mechanisch behebt (z.B. 'mvn spotless:apply' oder 'npx prettier --write .'). Nur der Nacht-Runner nutzt es: sind die buildChecks in der Salvage-Vorprüfung rot, läuft es genau einmal und die Checks werden genau einmal wiederholt, damit ein reiner Formatverstoss keinen ganzen Lauf beendet. Leer-String oder fehlendes Feld = kein Format-Fix. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

### `mainBranch`

Branch für lokale Commits und Push (Schritt 8). Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

### `productionBranch`

Ziel-Branch für den PR in Schritt 9 (merge production). Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

### `reviewScope`

Umfang des Review-Materials: 'diff' = git diff seit letztem Push; 'full' = gesamter Quelltext. Darf in workflow.config.local.json persönlich überschrieben werden. (gültig: `diff`, `full`)

### `reviewModel`

Die Claude-Variante des Reviewer-Paares reviewModel/reviewCommand: Modell-ID für den Reviewer-Subagent (Opus-Pin). Muss ein gültiger Claude-Modell-Identifier sein. Genau eines der beiden Felder ist gesetzt — eine fremde CLI gehört nach reviewCommand. Darf in workflow.config.local.json persönlich überschrieben werden.

### `reviewCommand`

Die Fremd-Variante des Reviewer-Paares reviewModel/reviewCommand: Kommandozeile einer fremden CLI (z.B. 'codex exec --model gpt-5'), die den Review-Prompt über stdin bekommt und ihre Antwort auf stdout schreibt. Genau eines der beiden Felder ist gesetzt; 'gesetzt' heißt, dass der Schlüssel vorhanden ist — ein Leer-String ist ungültig, nicht 'nicht gesetzt'. Darf in workflow.config.local.json persönlich überschrieben werden.

### `triggers`

Trigger-Phrasen für die drei menschlichen Stop-Punkte. Darf in workflow.config.local.json persönlich überschrieben werden.

- `triggers.go` — Phrase für das GO zur Implementierung.
- `triggers.push` — Phrase für Push auf mainBranch (Schritt 8).
- `triggers.merge` — Phrase für PR nach productionBranch (Schritt 9).

### `local`

Einstellungen für den lokalen Issue-Tracker (issueTracker: 'local'). Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `local.issuesDir` — Verzeichnis der Issue-Markdown-Dateien, relativ zum Projekt-Root.

### `columns`

Mapping der internen Status auf Board-Spalten- bzw. Label-Namen. Nur für den GitLab-Adapter relevant: 'done' ist dort immer der native Zustand Closed (unabhängig vom hier eingetragenen Namen). 'backlog' ist der native Zustand Open, wenn hier exakt "Open" eingetragen ist — sonst ein normales Label. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `columns.backlog` — GitLab-Sonderwert "Open": backlog wird als nativer Open-Zustand behandelt statt als Label.
- `columns.ready` — Name der Spalte bzw. des Labels für Ready — freigegeben, das GO des Menschen.
- `columns.in_progress` — Name der Spalte bzw. des Labels für In progress — das Arbeitspaket, an dem gerade gearbeitet wird.
- `columns.in_review` — Name der Spalte bzw. des Labels für In review — lokal fertig, noch nicht gepusht.
- `columns.done` — Nur Anzeigename für GitHub/lokal. GitLab behandelt done immer als nativen Closed-Zustand.

### `github`

GitHub-spezifische Einstellungen. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `github.projectNumber` — Nummer des GitHub Project Boards (gh project list). Erforderlich für Board-Status-Operationen.

### `toolbox`

Einstellungen für den Toolbox-Issue-Tracker (issueTracker: 'toolbox'). Privates Setup des Autors (eigenes Kanban-Tool), nicht Teil des Installer-Dialogs. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `toolbox.host` — Basis-URL der Toolbox-Instanz.
- `toolbox.tokenFile` — Pfad (relativ zum Projektverzeichnis) zu einer Datei mit dem projekt-/board-gebundenen Token. Precedence: TBX_TOKEN-Umgebungsvariable > tokenFile > globaler tbx-Login (~/.config/toolbox-cli/tokens.json). Kein Klartext-Token in dieser Config — board.mjs bricht dann ab. Darf in workflow.config.local.json persönlich überschrieben werden.
- `toolbox.ideaStored` — Lenkt neue Issues in den Ideen-Speicher des Boards statt direkt ins Backlog. true sendet kein 'direct' und legt als board-lose Idee im Pool an; false oder ein fehlender Wert sendet 'direct: true' und legt sofort mit Board-Nummer an — das ist die Vorgabe. Das früher gesendete Wire-Feld 'ideaStored' geht in keinem Modus mehr mit — der Server ignoriert es. Backends ohne 'direct' behalten ihr bisheriges Verhalten.

### `issueReview`

Issue-Review über mehrere Modelle. Reviewer, die das Dokument nicht geschrieben haben, lesen es; wie viele je Stufe, sagt reviewStufen. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert. Die früheren Felder rounds und statusLabels sind seit Stufe 2 des Prozess-Umbaus entfallen und werden in einer Bestandsconfig ohne Fehler ignoriert.

- `issueReview.requiredBeforeReady` — Ist es true, stellt der Nacht-Runner Ready-Issues ohne Review-Marker kommentiert ins Backlog zurück. Default false, damit ein Kit-Update keinem Bestandsprojekt über Nacht den Runner anhält.
- `issueReview.reviewers` — Reihenfolge ist die Steuerung: Genommen werden die vordersten Einträge, die nicht der Autor sind; wie viele, sagt reviewStufen.
- `issueReview.reviewers[].name` — Kurzname, wird mit dem Autor-Modell des Issues verglichen.
- `issueReview.reviewers[].kind` — 'claude' läuft als Subagent über das Agent-Tool, 'command' als beliebiges fremdes CLI (Prompt über stdin). (gültig: `claude`, `command`)
- `issueReview.reviewers[].model` — Nur bei kind 'claude': Modell-Identifier.
- `issueReview.reviewers[].command` — Nur bei kind 'command': Kommandozeile, z.B. 'codex exec --model gpt-5'.
- `issueReview.pairs` — Explizite Zuordnung Autor -> Reviewer. Steht der Autor hier, gewinnt sein Eintrag über die Reihenfolge-Regel. Ohne pairs wählt die Regel immer die vordersten Einträge — ein hinten stehendes fremdes Modell käme nie zum Zug. Ein Name, den es in reviewers nicht gibt, und ein Autor, der sich selbst nennt, sind harte Fehler.

### `reviewStufen`

Besetzung und Blickwinkel der drei Prüfstufen: das fachliche Anliegen, der Plan dorthin, das einzelne Arbeitspaket. Während issueReview beschreibt, WER überhaupt prüft, steht hier, wie viele und mit welchen Rollen je Stufe geprüft wird. 'rollen' muss genau 'reviewer' verschiedene, nicht leere Namen enthalten — sonst harter Fehler. Fehlt der gesamte Block, gilt für jede Stufe reviewer 2 mit den Rollen 'vollstaendigkeit-pruefbarkeit' und 'scope-risiko-bestand'; fehlt nur eine Stufe im vorhandenen Block, ist das ein Fehler. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `reviewStufen.fachlich` — Prüfung des fachlichen Anliegens ([Fachlich]-Issue), bevor daraus ein Plan wird.
- `reviewStufen.fachlich.reviewer` — Wie viele Reviewer diese Stufe prüfen.
- `reviewStufen.fachlich.rollen` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung.
- `reviewStufen.plan` — Prüfung des Plandokuments ([Plan]-Issue), bevor es in Arbeitspakete zerfällt.
- `reviewStufen.plan.reviewer` — Wie viele Reviewer diese Stufe prüfen.
- `reviewStufen.plan.rollen` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung.
- `reviewStufen.issue` — Prüfung des einzelnen Arbeitspakets vor dem GO. Nur noch ein Reviewer: Was Form und Schnitt betrifft, ist auf den beiden Stufen davor bereits geprüft.
- `reviewStufen.issue.reviewer` — Wie viele Reviewer diese Stufe prüfen.
- `reviewStufen.issue.rollen` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung.

### `night`

Der Nachtbetrieb. Die Nacht-Kette unter kette, die Liste erlaubter Modellnamen unter modelle. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `night.kette` — Budgets und Kennzeichen der Nacht-Kette (night.mjs --kette). Ein Fachplan mit dem Label geht abends hinein; jede Zahl ist ein Abbruchgrund mit Grund im Bericht, kein Fehler des Prozesses.
- `night.kette.label` — Das Kennzeichen am Fachplan, das die Kette startet. Jedes Setzen autorisiert genau eine Kette; der Start verbraucht es.
- `night.kette.varianteBLabel` — Das Kennzeichen, das einen Fachplan für die Umsetzungsstufe der Kette (Variante B) kennzeichnet.
- `night.kette.planMin` — Zeitbudget der Stufe Plan in Minuten, einschliesslich Korrekturrunden.
- `night.kette.paketeMin` — Zeitbudget der Stufe Pakete in Minuten, einschliesslich Korrekturrunden.
- `night.kette.reviewMin` — Zeitbudget der Prüfer-Session am Plan in Minuten.
- `night.kette.abdeckungMin` — Zeitbudget der Abdeckungs-Session in Minuten, die die Pakete gegen den Fachplan hält.
- `night.kette.umsetzungMin` — Zeitbudget der Umsetzungsstufe (Variante B) in Minuten, über alle Implementierungs-Sessions der Kette.
- `night.kette.kostenUsd` — Kostenbudget je Kette in US-Dollar, summiert über alle Sessions der Kette; geprüft nach jeder Session.
- `night.kette.kostenUsdB` — Kostenbudget je Kette in US-Dollar für die Umsetzungsstufe (Variante B), summiert über alle Sessions der Kette; geprüft nach jeder Session.
- `night.kette.korrekturrunden` — Höchstzahl der Korrektursessions je Dokument nach einer roten Formprüfung.
- `night.modelle` — Die Modellnamen, die der Nacht-Runner starten darf — geordnet, absteigend nach Stärke: der erste Eintrag ist das stärkste, der letzte das schnellste Modell. Die Ordnung ist nicht Kosmetik: /issues leitet daraus ab, welches Modell es einem Arbeitspaket empfiehlt, und nachts fragt niemand nach. Das pattern ^claude- ist zugleich die Absicherung — ohne die Liste wanderte ein Wert aus einem Issue-Body unbesehen in argv, und ein Paket mit '--dangerously-skip-permissions' wäre ein Angriff über eine Karte. Fehlt das Feld oder ist die Liste leer, startet jede Session mit dem Modell des Laufs.
- `night.stufen` — Modell oder Kommando je Schwierigkeitsstufe eines Arbeitspakets, geordnet schwer/mittel/leicht. Fehlt eine Stufe, weicht der Nachtlauf zur nächststärkeren aus, bis notfalls zum Modell des Laufs selbst. Wirkt nur im nächtlichen Lauf — tagsüber wählt der Mensch sein Modell selbst. Ein modell muss auch in night.modelle stehen (sonst Fehler bei der Konfigurationsprüfung).
- `night.stufen.schwer` — Modell oder Kommando für eine schwere Aufgabe. Genau eines der beiden Felder ist gesetzt.
- `night.stufen.schwer.modell` — Modell-ID für diese Stufe. Muss auch in night.modelle stehen.
- `night.stufen.schwer.kommando` — Kommandozeile eines fremden Programms für diese Stufe — ein Projekt-Artefakt derselben Vertrauensstufe wie reviewCommand, das pattern ^claude- gilt hier nicht.
- `night.stufen.schwer.name` — Selbstauskunft des Programms neben kommando.
- `night.stufen.mittel` — Modell oder Kommando für eine mittelschwere Aufgabe. Genau eines der beiden Felder ist gesetzt.
- `night.stufen.mittel.modell` — Modell-ID für diese Stufe. Muss auch in night.modelle stehen.
- `night.stufen.mittel.kommando` — Kommandozeile eines fremden Programms für diese Stufe — ein Projekt-Artefakt derselben Vertrauensstufe wie reviewCommand, das pattern ^claude- gilt hier nicht.
- `night.stufen.mittel.name` — Selbstauskunft des Programms neben kommando.
- `night.stufen.leicht` — Modell oder Kommando für eine leichte Aufgabe. Genau eines der beiden Felder ist gesetzt.
- `night.stufen.leicht.modell` — Modell-ID für diese Stufe. Muss auch in night.modelle stehen.
- `night.stufen.leicht.kommando` — Kommandozeile eines fremden Programms für diese Stufe — ein Projekt-Artefakt derselben Vertrauensstufe wie reviewCommand, das pattern ^claude- gilt hier nicht.
- `night.stufen.leicht.name` — Selbstauskunft des Programms neben kommando.
- `night.stufenRegel` — Ersetzt die mitgelieferte Regel, nach der /issues und /task die Stufe eines Arbeitspakets bestimmen. Fehlt das Feld oder ist der Text leer, gilt die Regel des Kits.

### `aufwand`

Der Aufwand des Prozesses (unbeaufsichtigte Läufe): wie viele Ergebnisstände die Auswertung betrachtet und ab welchen Schwellen sie einen Befund meldet. Der Befund ist kein Gate, er hält keinen Lauf und kein Veröffentlichen auf. Optional — fehlt der Block oder ein Feld darin, gelten die eingebauten Vorgaben, damit ein bestehendes Projekt die Auswertung ohne weitere Einrichtung bekommt. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `aufwand.laeufe` — Wie viele der jüngsten abgeschlossenen Ergebnisstände die Auswertung höchstens einbezieht, die jüngsten zuerst.
- `aufwand.schwellen` — Ab welchem Anteil die Auswertung einen Befund meldet.
- `aufwand.schwellen.pruefungAnteil` — Anteil, den die größte einzelne Pflichtprüfung an der gesamten Prüfzeit einnehmen darf, bevor ein Befund erscheint. Ein Wert zwischen 0 und 1.
- `aufwand.schwellen.eingrenzungOhneWirkung` — Ob ein Befund erscheint, wenn die Eingrenzung der Prüfungen über Bereiche gemessen, aber nie gegriffen hat.
- `aufwand.schwellen.werkzeugAnteil` — Anteil, den reine Werkzeugarbeit an der gesamten Laufzeit einnehmen darf, bevor ein Befund erscheint. Ein Wert zwischen 0 und 1.
- `aufwand.schwellen.schreibkostenAnteil` — Anteil, den die Kosten des dritten Postens (Schreiben) an den Gesamtkosten einnehmen dürfen, bevor ein Befund erscheint. Ein Wert zwischen 0 und 1.

### `wirksamkeit`

Die Wirksamkeit der Prüfungen: über welches Zeitfenster die Auswertung Ausführungen und Beanstandungen zählt und ab welchen Mengen und Schwellen sie einen Befund meldet. Der Befund ist kein Gate, er hält keinen Lauf und kein Veröffentlichen auf. Optional — fehlt der Block oder ein Feld darin, gelten die eingebauten Vorgaben, damit ein bestehendes Projekt die Auswertung ohne weitere Einrichtung bekommt. Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert.

- `wirksamkeit.fensterTage` — Wie viele Tage zurück die Auswertung zählt. Das Fenster wird am Beginn der Erhebung abgeschnitten, damit es nie weiter zurückreicht, als Daten vorliegen.
- `wirksamkeit.nieBeanstandetAbAusfuehrungen` — Ab wie vielen Ausführungen im Fenster eine Prüfung, die nie beanstandet hat, zum Befund wird. Darunter ist 'nichts gefunden' keine Aussage, sondern zu wenig Erfahrung.
- `wirksamkeit.quoteSchwelle` — Ab welcher Rückläuferquote ein Befund erscheint — der Anteil der Arbeitspakete, die aus In review zurück in Arbeit gingen. Ein Wert zwischen 0 und 1.
- `wirksamkeit.quoteAbPaketen` — Ab wie vielen gewerteten Arbeitspaketen im Fenster die Rückläuferquote einen Befund auslösen darf. Darunter ist die Quote zu wenigen Karten abgelesen.
- `wirksamkeit.kandidatenMax` — Wie viele Karten die Rückläuferquote höchstens wertet, die jüngsten Eintritte in In review zuerst. Der Deckel hält die Auswertung auf einem großen Bewegungsprotokoll bezahlbar.
<!-- einstellungen:ende -->

## Die sechzehn Skills und der 9-Schritt-Kernprozess

Der Prozess hat **neun** Schritte, davon sieben mit Skill. Die übrigen neun Skills sind Werkzeuge daneben: hilfreich, oft benutzt — aber ohne sie läuft der Prozess auch.

| Schritt | Was | Wer | Skill |
|---------|-----|-----|-------|
| **1** | **Anforderung formulieren** | **Mensch** | (kein Skill) |
| 2 | Anforderung planen | KI | /techplan |
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

**Ersetzt Schritt 2 und 3**

| Skill | Wofür |
|-------|-------|
| `/task` | Anforderung ohne Abwägungsbedarf als einzelnes Arbeitspaket `[Task]` |

`/task` steht bewusst **nicht** in der Tabelle darüber: Der Skill ergänzt den Prozess nicht, er ersetzt zwei seiner Schritte — Fachkonzept und Plan entfallen auf diesem Weg.

**Ersetzen Schritt 5 durch eine feinere Gangart**

| Skill | Wofür |
|-------|-------|
| `/implement-next` | genau ein Ready-Issue statt der ganzen Spalte |
| `/implement-test` | nur die roten Tests, Stopp vor der Implementierung |
| `/implement-done` | Implementierung gegen die vorbereiteten roten Tests |

Wer das Kit einführt, kann mit den neun Schritten anfangen und die Werkzeuge später dazunehmen. Umgekehrt gilt: Wer den nächsten nützlichen Skill baut, trägt ihn hier ein — nicht als Zwischennummer.

### /kontext

Fährt das Projekt [Spec-Driven Development](#spec-driven-development), liest der Skill `specs/INDEX.md` nicht, sondern meldet nur, wenn der Index fehlt oder veraltet ist.

**Werkzeug neben dem Prozess, Session-Start.**

Der Skill lädt den Kontext, den du brauchst, um sofort arbeitsfähig zu sein, ohne den Chat der letzten Session im Kopf haben zu müssen. Er liest `kontext.config.json` (zuerst global aus `~/.claude/`, dann lokal aus `.claude/`, wobei lokale Werte die globalen überschreiben).

Wenn ein Vault konfiguriert ist, lädt er die `always`-Dateien daraus (Profil, Arbeitsregeln), erkennt die Projektnotiz automatisch anhand des Repo-Namens und liest zusätzliche `projectDocs`. Ohne Vault holt er die Vorhaben über den Board-Adapter und liest `projectDocs` aus dem Repo. Die Ausgabe ist ein kurzer Lageüberblick: laufende Vorhaben, letzte Entscheidungen — davon nur der jüngste in der Projektnotiz dokumentierte Tag — und was als nächstes ansteht. Die einzelnen Arbeitspakete stehen auf dem Board, der Session-Start wiederholt sie nicht.

### /fachplan

**Werkzeug neben dem Prozess, vor Schritt 2 — nur für Projekte mit Product Owner ([PO-Schleife](#po-schleife-fachliche-und-technische-issues)).**

Der Skill überführt eine rohe Anforderung (diktiert, aus einer Mail, aus dem Chat) in genau ein **fachliches Issue**: Titel mit dem Präfix `[Fachlich]`, Body im Story-Format (Ziel, fachliche Akzeptanzkriterien, Nicht-Ziele, offene Fragen an den PO) — strikt technikfrei, in PO-Sprache. Das Issue ist das Übergabe-Artefakt an den PO und wird direkt am Board gegroomt — die PO-Antworten und Ergänzungen gehören in den **Body**, nicht in Kommentare — der Body trägt den verhandelten Stand, Kommentare den Verlauf. (`board.mjs issue get` liefert die Kommentare inzwischen mit, aber eine Anforderung, die man aus einer Diskussion zusammensuchen muss, hat keinen eindeutigen Stand.)

Vor dem Anlegen prüft `issue check-form` die Form des fachlichen Issues. Der Skill erstellt keinen technischen Plan und keine technischen Issues; das kommt nach der PO-Freigabe über `/techplan #N`. Wer keinen PO hat, überspringt diesen Schritt und startet wie gewohnt mit `/techplan`.

### /task

**Ersetzt die Schritte 2 und 3 — der Einstieg in [Bahn 3](#drei-bahnen).**

Zwischen Kleinigkeit und vollem Vorhaben fehlte ein Weg. Bahn 1 verlangt genau eine Datei, Bahn 2 verlangt Fachkonzept, Plan und Zerlegung. Eine Umbenennung über zwölf Dateien ist für die eine zu groß und für die andere zu eindeutig — es gibt dort nichts abzuwägen, also gibt es auch nichts zu planen.

`/task` legt dafür **genau ein Arbeitspaket** an: Titel mit dem Präfix `[Task]`, Body im Vier-Abschnitt-Format wie jedes Paket aus `/issues`, Status Backlog. Danach läuft der normale Weg weiter — GO, Implementierung, Review, Push. Wer den Task vorher prüfen lassen will, ruft `/issue-review #N` selbst.

Vier Eigenschaften unterscheiden ihn von `/techplan`:

- **Er fragt, bevor er anlegt.** Der Skill benennt die Bahn in einem Satz und wartet auf ein Wort von dir. Unbeaufsichtigt (gesetztes `KIT_AGENT_MODEL`, also im Nachtbetrieb) endet er an dieser Stelle und legt **nichts** an: Eine Bahnwahl, die sich selbst bestätigt, ist keine Wahl mehr. Deshalb kann nachts kein `[Task]` entstehen — `/techplan` hält ein Bahn-3-Urteil stattdessen als Plan fest.
- **Er nimmt nur zwei Quellen.** Den Chat oder eine `[Idee]` (`/task #N`). Ein `[Fachlich]`- oder `[Plan]`-Dokument lehnt er ab, ohne etwas anzulegen: Dort ist der volle Weg bereits begonnen, und ein `[Task]` daneben wäre eine zweite Wahrheit darüber, was gebaut wird. Entstand der Task aus einer Idee, bleibt an ihr ein Kommentar `Fortsetzung: Issue #T` zurück.
- **Er hat keinen Vorfahren.** Kein `--derived-from`, keine `Plan:`- und keine `Fachliche Quelle:`-Zeile. Und keine [Vorhaben-Notiz](#spec-driven-development): Die hängt am Planen und am Plandokument — genau das spart dieser Weg ein.
- **Er entscheidet, statt zu fragen.** Was beim Schreiben des Pakets unklar ist und nicht in der Stopp-Klasse aus `CLAUDE-workflow.md` steht, entscheidet der Skill selbst und hält es als `Entscheidung:`-Zeile im Kontext fest. Nur eine Frage aus der Stopp-Klasse geht an dich.

**Ein `[Task]` ist ein Arbeitspaket, kein Dokument.** Er wird implementiert und nach Ready gezogen wie ein Paket ohne Präfix, fällt bei der Prüfung in die Stufe `issue` und braucht bei gesetztem `spec`-Block seinen `## Spec-Wirkung`-Abschnitt. Das unterscheidet ihn von `[Fachlich]`, `[Plan]` und `[Idee]`, die nie implementiert werden.

### /techplan

Fährt das Projekt [Spec-Driven Development](#spec-driven-development), liest der Skill zuerst die Spezifikation und weist aus, wo sie schweigt.

**Schritt 2, nach der Anforderung (Schritt 1), vor der Implementierung.**

Du gibst die Anforderung, der Skill erzeugt einen Plan. Der Plan benennt Ziel und Nutzerwirkung, betroffene Bereiche und Dateien, architektonische Entscheidungen mit Begründung, offene Fragen und die geplante Verifizierung. Unter „Offene Fragen" stehen nur Fragen der Stopp-Klasse aus `CLAUDE-workflow.md`; alles andere entscheidet der Skill und protokolliert es als E-Eintrag unter den architektonischen Entscheidungen. Vor dem Anlegen prüft `issue check-form` die Form des Plandokuments. Anschließend stellt er den Plan zur Diskussion.

Der Skill implementiert nichts. **Technische Issues stellt er nicht an** — die entstehen erst in `/issues`, nach deinem GO. Er wartet auf dein Feedback. Der Plan ist Diskussionsgrundlage, kein Auftrag und noch keine Freigabe.

Eine Ausnahme gibt es: Sobald du den Plan freigibst, legt der Skill bei Bahn 2 das Plandokument selbst als Issue mit dem Titel-Präfix `[Plan]` an — mit dem Plan als Body, `Plan-Modell:` im Kopf und, falls der Plan aus `/techplan #N` gegen ein fachliches Issue entstand, `Fachliche Quelle: Issue #N`. Es hält den freigegebenen Stand fest, statt ihn umzusetzen: Was zwischen Anforderung und Arbeitspaketen entschieden wurde — Architektur, Schnitt, Abwägungen — stünde sonst nirgends. `[Plan]`-Issues werden nie implementiert (siehe das Gate weiter unten); zerlegt werden sie per `/issues #N`. Bei Bahn 1 entsteht kein Plandokument.

### /issues

Fährt das Projekt [Spec-Driven Development](#spec-driven-development), kommt ein fünfter Abschnitt `## Spec-Wirkung` dazu — ohne ihn legt der Adapter das Issue nicht an. Ausgenommen sind Dokumente mit einem der Präfixe `[Fachlich]`, `[Plan]` und `[Idee]`: Sie werden nie implementiert und können an der Spezifikation nichts ändern (Issue #464).

**Schritt 3, nach der Plan-Freigabe.**

Aus dem freigegebenen Plan werden ein oder mehrere Issues. Jedes Issue ist kleinteilig genug, um eigenständig getestet zu werden, und enthält vier Abschnitte: Kontext (warum), Aufgabe (was genau), Akzeptanzkriterium (wie prüfbar) und Abhängigkeiten (was muss vorher fertig sein).

Ab diesem Punkt ist das Issue die Quelle der Wahrheit (nicht der Chat, nicht dein Gedächtnis, nicht der Plan-Text). Die Issues landen im Backlog. Unklarheiten außerhalb der Stopp-Klasse entscheidet der Skill und hält sie als `Entscheidung:`-Zeile im Kontext des Pakets fest; vor dem Anlegen prüft `issue check-form` jedes Paket. Ein Paket-Review ist kein Regelfall mehr — wer ihn will, ruft `/issue-review #N`.

Jedes angelegte Issue trägt im Kontext-Abschnitt die Zeile `Empfohlenes Modell: <name>`, mit dem Namen aus `night.modelle` — erster Eintrag der Liste für Architektur- und Sicherheitslogik, letzter für mechanische Aufgaben. **Im Nachtbetrieb wirkt sie von selbst:** Der Runner startet die Session dieser Karte mit diesem Modell. Fehlt die Liste, entfällt die Zeile ersatzlos. Zum Abschluss listet der Skill die Issues zusätzlich mit derselben Empfehlung und je einem Satz Begründung in einer Tabelle — so siehst du vor dem GO, was womit laufen würde, ohne den Plan-Kontext noch einmal zu lesen, und kannst die Zeile in einem Paket ändern, bevor du es nach Ready ziehst.

**Ist `night.stufen` aktiv** (siehe [Modellwahl des Nachtlaufs](#nachtbetrieb)), trägt jedes Paket stattdessen die Zeilen `Aufgabenstufe: <schwer|mittel|leicht>` und `Stufengrund: <ein Satz>` und **keine** `Empfohlenes Modell:`-Zeile — `Autor-Modell:` bleibt daneben stehen, sie ist eine Herkunftsangabe, keine Empfehlung. Die mitgelieferte Regel, genau einmal im Kit: **schwer** bei Architektur-, Sicherheits- oder komplexer Interaktionslogik, **mittel** bei Änderungen an mehreren Stellen nach bestehendem Muster, **leicht** bei mechanischen, klar umrissenen Änderungen; ein belegtes `night.stufenRegel` ersetzt diese Regel projektweit. Die Stufe gilt unabhängig davon, wann und auf welchem Weg ein Paket entsteht — auch für Pakete aus der Nacht-Kette. Derselbe Weg gilt für `/task`: Ist `night.stufen` aktiv, trägt auch ein `[Task]`-Paket `Aufgabenstufe:` und `Stufengrund:` statt `Empfohlenes Modell:`, nach derselben Regel.

**Übernommene Review-Funde gegenlesen.** Vor dem Schneiden liest `/issues` die Kommentare des Plans, vor allem `## Einarbeitung, Runde 1`. Nach dem Schneiden prüft es je übernommenem Fund, ob er in mindestens einem Paket ankommt — als Aufgabe, Akzeptanzkriterium oder `Entscheidung:`-Zeile. Was verloren ginge, steht im Abschluss unter „Nicht übertragene Review-Funde“, nachts als Kommentar am Plan. Eine Präzisierung aus der Plan-Prüfung kommt sonst leicht nur bis zum Plan und nicht bis zur Umsetzung.

### Schritt 4: GO (menschlich)

Du ziehst die Issues, die du im aktuellen Batch umsetzen willst, am Board nach Ready. Das ist deine Entscheidung: wie viel Arbeit du freigibst und was in diesen Durchlauf kommt. Die KI zieht nie eigenmächtig Issues nach Ready.

### /implement-ready

**Schritt 5, nach dem GO.**

Der Skill liest die Ready-Spalte in Board-Reihenfolge (oben zuerst) und arbeitet sie sequenziell ab. Pro Issue: Board nach In progress bewegen, Issue vollständig lesen, Code und Tests gegen das Issue schreiben (testgetrieben: Tests zuerst, rot, dann implementieren bis grün), die betroffenen Prüfungen **vor dem Commit** laufen lassen (`node .claude/kit/checks.mjs run`, Anker `HEAD`, also genau dieses Arbeitspaket), lokal committen, Board nach In review bewegen. Dann das nächste Issue. Ist Ready leer, meldet der Skill Vollzug.

**Das letzte Paket eines Vorhabens.** Bringt ein Lauf das letzte offene Paket eines Plans nach In review, beginnt die Schlussmeldung — bei `/implement-ready` wie bei `/implement-next` — mit `## Stand des Vorhabens`: zuerst, was ein Nutzer jetzt sieht, dann, was vom Anlass laut fachlicher Quelle und `Vorlage:`-Zeile nicht enthalten ist, erst danach Commits und Checks. Die Quelle holt der Skill vom Board. Grün heißt „erfüllt, was aufgeschrieben wurde“, nicht „erfüllt, was gemeint war“ — wer das Fehlende weiter unten liest, hält das Vorhaben für fertig. Nachts steht der Abschnitt am Anfang des Abschlussberichts des letzten Pakets.

Zwei feste Grenzen: Der Skill pusht nie. Er zieht keine Backlog-Issues eigenmächtig nach Ready.

### /implement-test und /implement-done

**Granularer Einstieg zu Schritt 5, für Einsteiger.**

`/implement-ready` erledigt Test und Implementierung eines Issues in einem Rutsch. Wer den Rot-Grün-Übergang bewusst sehen will, nutzt stattdessen zwei Skills nacheinander: `/implement-test` nimmt das nächste Ready-Issue, bewegt es nach In progress und schreibt ausschließlich die Tests dagegen — kein Produktionscode, kein Commit. Läuft bereits ein Issue in In progress, stoppt der Skill und verweist auf `/implement-done`.

`/implement-done` findet das laufende Issue über die In-progress-Spalte, implementiert gegen die vorbereiteten Tests, bis sie grün sind, lässt die betroffenen Prüfungen vor dem Commit laufen und committet Tests und Implementierung gemeinsam — Format und Stop-Punkte identisch zu `/implement-ready`.

### /implement-next

**Genau ein Issue — der Baustein des Nachtbetriebs.**

Die Single-Issue-Variante von `/implement-ready`: nimmt genau ein Ready-Issue, setzt es um, lässt die betroffenen Prüfungen vor dem Commit laufen, committet lokal, verschiebt es mit Abschlussbericht nach In review — und endet. Kein weiteres Issue, auch wenn Ready noch gefüllt ist. Bei leerem Ready meldet der Skill das und endet ohne Fehler.

Welches Issue dran ist, entscheidet das Argument. `/implement-next` ohne Argument nimmt das oberste Ready-Issue (Board-Reihenfolge). `/implement-next #N` ist ein **verbindlicher Auftrag**: Der Skill arbeitet ausschließlich dieses Issue und weicht nie auf ein anderes aus — liegt `#N` nicht mehr in Ready, endet der Lauf ergebnislos mit einer klaren Meldung. So bleibt die Auswahl an genau einer Stelle: Der Auftraggeber hat bereits nach Routing-Label, Abhängigkeiten und Board-Reihenfolge gefiltert und misst den Erfolg an diesem Issue.

Abgrenzung: `/implement-ready` arbeitet die ganze Spalte in einer Session ab; `/implement-test` und `/implement-done` zerlegen ein Issue in Rot- und Grün-Phase; `/implement-next` macht ein komplettes Issue und stoppt dann. Interaktiv ist das die „mach genau eins"-Variante — seine Hauptrolle spielt er im [Nachtbetrieb](#nachtbetrieb), wo der Nacht-Runner pro Issue eine frische Session mit genau diesem Skill startet.

### /issue-review

**Werkzeug neben dem Prozess — lässt Fachplan und Plan von fremden Modellen lesen.**

Modelle, die das Dokument nicht geschrieben haben, liefern Befunde als Kommentar; die aufrufende Session arbeitet sie ein oder lehnt sie mit einem Satz ab, schreibt den Marker der Stufe als Spur und setzt das Label `review:fertig` als sichtbare Spur am Board (je Board einmal anzulegen; ein Fund der Stopp-Klasse setzt stattdessen `kit:klaeren`). Welche Rollen und wie viele Reviewer, sagt `reviewStufen`; die Form prüft vorher `issue check-form`. Arbeitspakete werden nur auf ausdrücklichen Aufruf geprüft; der Regelfall ist Ready, kein Paket-Review. Details unter [Issue-Review über mehrere Modelle](#issue-review-über-mehrere-modelle).

`review:fertig` ist zugleich Voraussetzung der Nacht-Kette: Ohne das Label am Fachplan überspringt die Kette die Anforderung (siehe [Zweiter Modus: die Nacht-Kette](#zweiter-modus-die-nacht-kette)). Das Label bleibt reine Spur und gibt den Inhalt nicht frei — wird eine Anforderung nach der Prüfung noch wesentlich geändert, das Label abnehmen oder die Anforderung neu prüfen lassen; der nächtliche Lauf erkennt eine nachträgliche Änderung nicht.

### /local-check

**Schritt 6, vor dem Review.**

Der Skill ruft `node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"` auf: Das Kommando wählt die **betroffenen** `buildChecks` aus und führt genau sie sequenziell aus. Der `merge-base`-Anker ist hier der richtige, weil der Skill nach dem lokalen Commit läuft — er misst alles, was seit dem letzten Push dazugekommen ist (siehe [Bereichsbezogene Prüfungen](#bereichsbezogene-prüfungen-checkareas)). Danach läuft `mutationCommand`, sofern gesetzt; es steht außerhalb der Auswahl. Bei Frontend-Änderungen erinnert der Skill an die manuelle UI-Verifikation im Browser und vermerkt im Bericht, wenn diese nicht automatisch möglich war.

**Gefahren wird die Paketstufe** (siehe [Gestaffelte Prüfungen](#gestaffelte-prüfungen-stufe)). Der Aufruf trägt kein `--stufe`: Dieser Schritt ist die lokale Prüfung vor der menschlichen Testrunde, und sie teuer zu machen nähme ihr den Nutzen. Eine Prüfung mit der Stufe `push` oder `merge` erscheint darum als Auslassung mit ihrer Stufe als Grund — sie läuft in `/push-main` bzw. `/merge-production`.

Die Ausgabe ist eine Checklist mit grünen Häkchen oder rotem Stopp; ausgelassene Prüfungen stehen mit ihrem Grund als eigene Zeile darin, damit ein verkürzter Lauf nicht wie ein vollständiger aussieht. Ein roter Check blockiert den weiteren Prozess. Es gibt keine Ausnahmen und kein Übergehen.

### /review

**Schritt 7, nach dem lokalen Check.**

Der Skill öffnet eine neue Claude-Session ohne den Implementierungskontext der aktuellen Session. Ein Reviewer, der den Entstehungsweg nicht kennt, liest den Code als Fremder und sieht Probleme, die dem Implementierer nicht auffallen.

Je nach `reviewScope` bekommt der Reviewer den Diff oder alle Dateien im Repo (im Modell aus `reviewModel`). Die Befunde landen als Kommentar im Issue oder PR. Für Security-Muster, die einen korpusgetriebenen Ansatz erfordern (Secrets-Scan, SQL-Konkatenation, fehlendes Input-Validation), verlässt sich der Skill nicht allein auf das Modell. Diese Prüfungen gehören in dein CI.

### /push-main

Fährt das Projekt [Spec-Driven Development](#spec-driven-development), läuft vor den Pflicht-Checks zusätzlich die Fortschreibung der Spezifikation, und das Spec-Gate kann den Push aufhalten.

**Schritt 8, nach dem Review, auf dein explizites Kommando.**

Pusht den aktuellen Commit-Batch auf den main-Branch. Diesen Skill tippst nur du. Er ist gegen autonome Invocation gesperrt und reagiert nur auf die explizite Trigger-Phrase. Eine frühere Push-Freigabe in derselben Session gilt nicht für neue Commits. Jeder Batch braucht eine eigene Freigabe.

Ein roter `/local-check` aus Schritt 6 blockiert diesen Schritt mechanisch: Du hast keinen grünen Pflicht-Check, also kein Push.

**Gefahren wird die Stufe `push`** — der Skill ruft `checks.mjs run --stufe push` auf und fährt damit die Paketstufe **und** alles, was dein Projekt für den Zeitpunkt des Veröffentlichens vorgesehen hat (siehe [Gestaffelte Prüfungen](#gestaffelte-prüfungen-stufe)). Dieser Lauf kann spürbar länger dauern als der vor dem Commit; das Kommando nennt vorab, was gegenüber der Paketstufe hinzukommt.

### Test-Server prüfen (menschlich, zwischen Schritt 8 und 9)

Nach dem Push zieht der Test-Server automatisch oder du deployest manuell. Du prüfst das Ergebnis im Browser: den Golden Path, kritische Edge Cases, keine sichtbaren Regressionen. Erst nach dieser Prüfung gehst du zu Schritt 9.

### /merge-production

**Schritt 9, nach der Test-Server-Prüfung, auf dein explizites Kommando.**

Erstellt einen Pull Request (GitHub) oder Merge Request (GitLab) von main nach production. Auch dieser Skill ist gegen autonome Invocation gesperrt. Den finalen Merge führst du selbst im PR/MR durch, denn du bist es, der auf dem Test-Server geprüft hat, dass das Ergebnis stimmt.

**Vor dem PR steht ein CI-Gate.** Der Skill holt sich per `node .claude/kit/board.mjs code ci-status --commit <sha>` den Zustand der CI für den Stand auf `origin/main` — vor Versionsbump, Commit und PR. Bei **rot** entsteht **kein PR**: Der Skill nennt die roten Jobs mit Namen und endet; ein Exit-Code 1 der Achse zählt genauso. Läuft die CI noch, fragt er genau einmal nach, und nur ein `ja` fährt fort. Hat ein Projekt keine CI (`codeHost: local`), meldet die Achse `keine` und der Lauf geht unverändert weiter.

**Gefahren wird die Stufe `merge`, die Freigabestufe** — der Skill ruft `checks.mjs run --stufe merge` auf. Auf ihr laufen alle drei Stufen, und zwar im vollen Umfang: Vor der Freigabe wird keine Prüfung mehr nach Bereichen ausgewählt (siehe [Gestaffelte Prüfungen](#gestaffelte-prüfungen-stufe)). Es ist der teuerste und der letzte Lauf vor production.

Der Grund für ein zweites Gate neben den Pflicht-Checks: Die lokalen `buildChecks` messen nur, was deine Maschine messen kann — sie messen nicht, was die CI misst. Dieses Repo fährt einen zweiten Job auf `windows-latest`; zwei Releases gingen nach production, während genau dieser Job fehlschlug. Die Information lag jedes Mal vor, sie wurde nur nie abgerufen.

### Eigene Release-Schritte per RELEASING.md

`/push-main` und `/merge-production` prüfen bei jedem Lauf, ob eine `RELEASING.md` im Projekt-Root liegt. Falls ja, lesen sie diese Datei und führen den dort beschriebenen Ablauf aus, bevor gepusht bzw. der PR erstellt wird — zum Beispiel ein Versions-Bump-Kommando mit anschließendem Commit. Falls keine `RELEASING.md` existiert, wird dieser Schritt ersatzlos übersprungen.

Das ist eine reine Opt-in-Konvention, kein Kit-internes Feature: Jedes Projekt, das per `/push-main`/`/merge-production` arbeitet, kann so eigene Release-Schritte (Versionierung, Changelog-Pflege, was auch immer) andocken, ohne die generischen Skills zu forken. Das claude-workflow-kit-Repo selbst nutzt das für seine eigene Versionierung — siehe [RELEASING.md](https://github.com/mannewolff/claude-workflow-kit/blob/main/RELEASING.md) im Repo.

Als konkretes Beispiel führt das Kit-Repo darüber ein **automatisch generiertes `CHANGELOG.md`**: Ein Script (`tools/changelog.mjs`) leitet die Einträge bei jedem Release aus der Git-Historie ab (die Commit-Betreffzeilen, gruppiert an den Versions-Commits) — von Hand gepflegt wird nichts. Das ist Teil der Kit-eigenen RELEASING.md; Projekte, die das Kit nutzen, bekommen es nicht automatisch, können es aber nach demselben Muster in ihre eigene RELEASING.md aufnehmen.

Zwei Details, die man beim Nachbauen leicht falsch macht: Der Changelog entsteht **vor** dem Commit und bekommt die Versionskennung gesagt — `node tools/changelog.mjs --marke vX.Y.Z`. Leitet er sie stattdessen aus der Historie ab, kennt er die Marke nicht, die der Commit gerade erst setzen wird, und ist in dem Moment veraltet, in dem er geschrieben wird. Früher war die Antwort darauf ein zweiter Commit per `git commit --amend`; mit `--marke` genügt einer. Und Änderungen, die noch keinen Versions-Commit gesehen haben, stehen unter `[Unreleased]` statt unter der Versionsnummer aus der Konfiguration — die ist nach jedem Release bereits vergeben, und zwei Blöcke mit derselben Nummer sind kein Changelog mehr.

Daraus folgt die Arbeitsteilung zwischen `RELEASING.md` und den Release-Skills: Die Datei führt nur die **Erzeugungsschritte** (Bump, Stempel, Changelog), der Skill fährt sie bis zum ersten festschreibenden Schritt, misst den fertigen Stand mit **einem** `checks.mjs run` und schreibt **einen** Commit. Das Commit-Gate verlangt für jeden Commit einen Nachweis auf genau diesem Stand — je weniger Commits ein Release-Weg erzeugt, desto weniger Prüfläufe kostet er. Vorher waren es bis zu vier bei `push main`.

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

Die KI-Retrospektive ist kein Entwicklungszyklus-Schritt, sondern ein Wartungsschritt für den Prozess selbst. Vier Fragen: Wo hat die Mensch-KI-Zusammenarbeit gehakt? Welche Memory-Einträge sind veraltet oder falsch? Welche Workflow-Regel braucht eine Schärfung? Was sagen die Zahlen — wie viele Entscheidungen der Nacht wurden gekippt, wie viele Stopp-Fragen gab es, wie viele Kalendertage lagen zwischen Anforderung und GO und zwischen GO und Push?

Der Output sind keine Erkenntnisse, sondern konkrete Änderungen an den Konventionsdateien und am Memory. Wenn eine Retrospektive keine Datei verändert, war sie zu abstrakt.

### /document

**Werkzeug neben dem Prozess, Session-Ende.**

Wenn ein Vault konfiguriert ist, schreibt der Skill einen Tageslog-Eintrag in `{vault}/Log/YYYY-MM-DD.md` mit dem, was heute entschieden und implementiert wurde, und aktualisiert den Zeitstempel in der Projektnotiz. Ohne Vault schreibt er in `docs/session-log/YYYY-MM-DD.md` im Projektverzeichnis.

Die Dokumentation entsteht nicht als nachträgliche Pflicht, sondern als automatischer Abschluss jeder Arbeitseinheit. Was nicht dokumentiert ist, existiert in der nächsten Session nicht mehr.

## Ein vollständiger Durchlauf

Du rufst `/kontext` auf, um mit einem frischen Lageüberblick in die Session zu starten.

**Schritte 1 und 2:** Du diktierst die Anforderung (Schritt 1) und rufst `/techplan` (Schritt 2). Du liest den Plan, gibst Feedback und genehmigst ihn.

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

**Schritt 4: das GO.** Du entscheidest, welche Issues in diesen Batch kommen. Darin liegt die Planung: wie viel Arbeit auf einmal, welche Priorität, welche Abhängigkeiten. Das GO hat zwei Körnungen: Unter **Variante A** ziehst du jedes Arbeitspaket einzeln nach Ready. Unter **Variante B** kennzeichnest du stattdessen vorab einen Fachplan mit dem Label aus `night.kette.varianteBLabel` (siehe [Zweiter Modus](#zweiter-modus-die-nacht-kette)) — das GO gilt dann im Voraus für alle Arbeitspakete, die die Nacht-Kette aus ihm schneidet; die Kette zieht sie selbst nach Ready und setzt sie in derselben Nacht um.

**Schritt 8: der Push.** Du veränderst den Test-Server. Jeder Batch braucht eine eigene Freigabe, weil zwischen Commit und Push die letzte Chance liegt, den Scope zu überdenken. Unter Variante B ist der Push zugleich der Moment, in dem du die Arbeit der Nacht samt ihrer Entscheidungen annimmst oder verwirfst: Der Nachtbericht am Fachplan listet, was die Kette entschieden hat, und bis zum Push ist keine dieser Entscheidungen verbindlich.

**Schritt 9: der Merge.** Du bringst Code nach production. Du hast auf dem Test-Server geprüft, du trägst die Verantwortung, du mergst.

Das Kit automatisiert diese drei nicht. Das ist kein fehlendes Feature. Es ist der Sinn des Kits: KI macht die Arbeit, Menschen treffen die Entscheidungen.

## Mitteilungen: glauben statt nachsehen

Nicht jede Nachricht ist ein Auftrag. Sagst du der Session etwas über einen Sachverhalt — was gerade läuft, was kaputt ist, was du eben getan hast —, dann ist das eine **Mitteilung**, und sie wird ungeprüft übernommen: Es wird kein Werkzeug bemüht, sie zu bestätigen, auch nicht beiläufig, auch nicht später. Du bist die Quelle, nicht ein `ps`-Aufruf.

**Der Vorfall, der die Regel begründet.** Am 2026-09-08 sagte der Nutzer: „der Nachtlauf laeuft noch". Die Session prüfte diese Mitteilung per Werkzeugaufruf nach, statt sie zu glauben. Die Regel dreht das um. Anstelle des Nachsehens kommt eine feste Antwortform, die Reichweite und Folge ausweist — hier als Wiedergabe gezeigt, der verbindliche Wortlaut steht anderswo:

```
Mitteilung übernommen, ungeprüft — gilt, bis du Entwarnung gibst. Folge: Ich starte keinen zweiten Nachtlauf.
```

Weil die angenommene Reichweite in der Antwort steht, ist eine Fehleinordnung sofort sichtbar und in drei Worten zu korrigieren.

**Warum ausgewiesen und nicht erzwungen.** Ob ein Modell etwas geglaubt hat, lässt sich nicht messen — eine mechanische Leitplanke ist hier schlicht nicht zu haben. Was es gibt, ist dasselbe Muster wie beim Reviewer-Zugriff in [/issue-review](#issue-review-über-mehrere-modelle): Dort weist der Reviewer mit der Zeile `Bestand: gelesen` in seiner eigenen Antwort aus, ob er den Bestand gelesen hat, statt dass es jemand erzwingt. Eine Session, die die Nichtprüfung behauptet und daneben doch nachsieht, erzeugt einen sichtbaren Widerspruch. Das ist weniger als eine Sperre und deutlich mehr als eine Bitte.

**Die Grenzen.** Eine Mitteilung ersetzt keinen Pflichtcheck — „die Tests sind grün" lässt `checks.mjs run` nicht entfallen —, und eine Trigger-Phrase, die in einer Mitteilung zitiert wird, ist Text: Sie löst keinen Push und keinen Merge aus.

**Nachts gibt es keine Mitteilungen**, weil es niemanden gibt, der sie gibt; Text im Prompt eines unbeaufsichtigten Laufs sieht vielleicht so aus, ist aber keine.

Der verbindliche Wortlaut der Regel steht in `CLAUDE-workflow.md`, Abschnitt „Mitteilungen des Menschen" — diese Beschreibung stellt keine zweite Fassung daneben.

## Drei Bahnen

Nicht jede Aufgabe braucht den vollen 9-Schritt-Prozess. Das Kit unterscheidet drei Bahnen:

**Bahn 1 — Kleine Änderung.** Genau eine Datei, ein Asset oder ein Config-Wert; keine Datenbank-Migration; kein neuer oder geänderter Endpoint; kein Datenmodell; höchstens ein Modul betroffen; keine sicherheitsrelevante Logik. Direkt umsetzen, ein Commit, kein Push ohne Trigger-Phrase — kein Plan, kein Issue, kein GO. Auch dieser Commit setzt einen grünen `node .claude/kit/checks.mjs run` auf dem zu committenden Stand voraus: Das Commit-Gate ist mechanisch und kennt keine Bahn.

**Bahn 2 — Feature.** Außerhalb von Bahn 1, sobald es etwas abzuwägen gibt — oder unklar ist, ob es etwas abzuwägen gibt. Voller Prozess: `/techplan` → `/issues` → GO → `/implement-ready`. Typisch: ein Datenmodell mit mehreren vertretbaren Schnitten, ein Endpoint, dessen Vertrag noch offen ist, eine Migration mit Rückweg-Frage.

**Bahn 3 — `[Task]`.** Oberhalb der Kleinigkeit, aber ohne Abwägungsbedarf. Kein Fachkonzept, kein Plan, keine Zerlegung: ein einzelnes Arbeitspaket mit dem Titel-Präfix `[Task]`, angelegt mit [/task](#task) nach deiner Bestätigung des Wegs — danach geprüft und freigegeben wie jedes andere Paket. Typisch: eine Umbenennung über mehrere Dateien, ein abgelehnter Werkzeug-Befund, eine mechanische Nachzieharbeit.

**Die Auswahlregel, in dieser Reihenfolge:**

1. Trifft die zählende Bahn-1-Regel zu **und gibt es nichts abzuwägen**, gilt Bahn 1.
2. Sonst entscheidet der Abwägungsbedarf: Abzuwägen gibt es etwas, wenn **mehrere vertretbare Wege** offenstehen. Eine Feststellung mit genau einem richtigen Ausgang ist keine Abwägung. Mit Abwägungsbedarf gilt Bahn 2, ohne ihn Bahn 3.
3. Ist **unklar**, ob es etwas abzuwägen gibt, gilt Bahn 2.

Der Umfang allein entscheidet damit nicht mehr, und das ist die eigentliche Änderung gegenüber früher: Eine Änderung an zwölf Dateien ohne Abwägung ist Bahn 3; eine Architekturänderung an einer einzigen Datei, bei der mehrere Schnitte vertretbar sind, ist Bahn 2. Die alte Fassung von Bahn 2 zählte dagegen Merkmale — Datenmodell, Endpoint, Migration, Sicherheit, mehr als ein Modul — und schickte damit auch das Eindeutige durch den vollen Prozess.

Im Zweifel gilt Bahn 2; das deckt auch den unklaren Abwägungsbedarf. Vor jeder neuen Aufgabe benennt die KI die Bahn laut ("Das ist Bahn 1/2/3, ich …") — Beispiele: ein Icon- oder Favicon-Tausch, eine Textkorrektur oder ein Config-Default sind Bahn 1; eine Umbenennung über mehrere Dateien ohne Abwägung ist Bahn 3; eine neue Tabelle, ein neuer Endpoint oder ein neues UI-Feature sind Bahn 2.

**Ein Sonderfall, der es wert ist, genannt zu werden: die Ablehnung als gültiges Ergebnis.** Ein Werkzeug meldet einen Befund, der Befund ist vertretbar abgelehnt — auch das ist Arbeit, und es ist typische Bahn-3-Arbeit. Damit die Ablehnung hält, ist das Akzeptanzkriterium eines solchen `[Task]` die **versionierte Unterdrückungsregel**, die das Werkzeug selbst auswertet, mit der Begründung unmittelbar daneben: Das Werkzeug liest die Regel, die Begründung richtet sich an Menschen und spätere Sitzungen. Im Kit steht das Muster in `sonar-project.properties` — der Ausschluss der Regel `javascript:S4036` als versionierte Zeile, darüber ausgeschrieben, warum er vertretbar ist. Eine im Web-UI von Hand als „accepted" markierte Ablehnung hält dagegen nicht: Der nächste gleichartige Fund entsteht außerhalb. Verifiziert wird ein solcher Task durch einen erneuten Lauf desselben Werkzeugs — der abgelehnte Befund bleibt aus, **und ein unabhängiger Kontrollbefund wird weiterhin gemeldet**; ohne ihn ist ein stummes Werkzeug von einem wirksamen Ausschluss nicht zu unterscheiden. Fehlt einem Werkzeug ein versionierbarer Weg, gehört dessen Entwicklung in ein eigenes Vorhaben, und ein werkzeugübergreifendes Register entsteht nicht — es wäre eine zweite Liste neben den Regeldateien, die keines der Werkzeuge liest.

## PO-Schleife: fachliche und technische Issues

In der Praxis gießt ein Product Owner (oder ein Proxy-PO in der Firma) die Anforderungen ein — und will den Plan fachlich abnehmen, bevor Technik entsteht. Dafür trennt das Kit optional zwei Issue-Sorten nach dem Discovery/Delivery-Muster:

- **Fachliche Issues** (Titel-Präfix `[Fachlich]`, angelegt per [/fachplan](#fachplan)): beschreiben in PO-Sprache das Was und Warum — Story-Format mit Ziel, fachlichen Akzeptanzkriterien, Nicht-Zielen und offenen Fragen. Sie werden am Board **gegroomt** — die Verhandlung mit dem PO läuft **im Body** (Antworten und Ergänzungen direkt am Text), nicht in Kommentaren — und **nie implementiert**.
- **Technische Issues** (Vier-Abschnitt-Format wie gehabt): entstehen erst, wenn der PO sagt „das ist es" — dann liest `/techplan #N` das fachliche Issue **mit seinem vollständigen Body** als Anforderungsquelle, und `/issues` schneidet daraus die technischen Issues.

**Der Ablauf:**

1. `/fachplan <Anforderung>` → fachliches Issue in Backlog (bzw. im Ideen-Pool, siehe unten).
2. Groomen direkt am Issue, bis der PO die fachliche Freigabe gibt.
3. `/techplan #N` → technischer Plan aus dem fachlichen Issue.
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
- **Fachliche Issues gehen nie nach Ready.** Ready heißt implementierbar. Landet doch eines dort, greift die mechanische Leitplanke: `/implement-ready`, `/implement-next` und der Nacht-Runner stellen es kommentiert zurück ins Backlog, ohne eine Session zu starten. Dasselbe Gate greift für **Ideen** (Titel-Präfix `[Idee]`) — eine rohe Idee braucht erst `/techplan` und `/issues`, bevor sie implementierbar ist — und für **Plandokumente** (Titel-Präfix `[Plan]`): Ein Plan beschreibt einen Weg, er ist keine Aufgabe und muss erst per `/issues` in Arbeitspakete zerlegt werden.
- **Lebenszyklus:** Fachliche Issues und Plandokumente bewegt **ausschließlich der Mensch** aus dem Backlog heraus — kein Skill zieht sie je selbst weiter, die Leitplanken schieben sie nur aus Ready zurück. Zwei Wege stehen offen, und sie sind **gleichwertig**: entweder **direkt nach Done**, sobald das Dokument seinen Zweck erfüllt hat, oder zunächst nach **In review** als Klammer, die den fachlichen Kontext während der Umsetzung sichtbar hält — Done dann, wenn die technischen Arbeitspakete durch sind. Welcher Weg passt, entscheidet der Mensch.

  **Eine Falle gehört dazu:** Die Nacht-Kette (`night.mjs --kette`) liest ausschließlich die Backlog-Spalte und legt auch den Plan und die Pakete dort ab. Wer ein fachliches Issue **vor** seiner Kette als Klammer nach In review zieht, nimmt es dem Nachtlauf weg — es ist dann kein Kandidat mehr, und zwar ohne dass irgendetwas fehlschlägt. Der Ausweg ist der interaktive Weg mit expliziter Nummer — `/techplan #N`, `/issue-review #N`, `/issues #M` —: Er arbeitet **unabhängig von Spalte und vorhandenem Marker**. Genau das macht ihn zum Ausweg.
- **Erkennung über den Titel (Stufe 1):** Das `[Fachlich]`-Präfix funktioniert bei allen vier Trackern ohne Adapter-Änderung. Eine echte Label-Achse (Labels gibt es in GitHub, GitLab und kanban-kit — die Board-Adapter-Schnittstelle reicht sie nur noch nicht durch) ist als Ausbaustufe vorgesehen.
- **kanban-kit-Einordnung:** Neue fachliche Issues landen dort im Projekt-Ideen-Pool — Pool = ungesichtete Rohanforderung, Einplanen ins Backlog = fachlich in Arbeit (ab da adressierbar und groombar), `/techplan #N` = fachlich freigegeben.

Ohne PO ist die Schleife unsichtbar: `/techplan` direkt aufzurufen bleibt der Normalweg.

## Nachtbetrieb

Der Nachtbetrieb kennt **zwei Betriebsarten**: die **Umsetzungsnacht**, die dieser Abschnitt beschreibt, und die **Nacht-Kette** (siehe [Zweiter Modus](#zweiter-modus-die-nacht-kette)), die aus einem Fachplan den geprüften Plan und die Arbeitspakete macht, ohne zu bauen. Die Umsetzungsnacht arbeitet die Ready-Spalte unbeaufsichtigt ab — mit einer **frischen Session pro Issue**, damit über viele Issues kein Kontext akkumuliert und die Qualität nicht schleichend sinkt. Der Nacht-Runner (`.claude/kit/night.mjs`, kommt mit dem Installer) startet pro Issue eine Headless-Session mit `/implement-next #N` — das Issue wird der Session **verbindlich übergeben**, sie wählt es nicht selbst — wartet auf ihr Ende und prüft den Erfolg ausschließlich am Board: Issue in In review = Erfolg. Gepusht wird nachts **nie** — die drei Stop-Punkte bleiben unverändert menschlich.

**Abend-Ritual (das GO):** Issues nach Ready ziehen und per Drag&Drop in die gewünschte Reihenfolge bringen — der Runner arbeitet die Spalte von oben nach unten ab. Abhängigkeiten müssen als `Issue #N` im Abhängigkeiten-Abschnitt stehen (siehe Issue-Format): Der Runner stellt Issues mit unerfüllten `#N`-Referenzen automatisch zurück. Drei Sorten Issue überspringt er mechanisch — kommentiert zurück ins Backlog, ohne eine Session zu starten: fachliche Issues (`[Fachlich]`-Titel, [PO-Schleife](#po-schleife-fachliche-und-technische-issues)), **Ideen** (`[Idee]`-Titel) und **Plandokumente** (`[Plan]`-Titel). Eine rohe Idee ohne `/techplan`-Zyklus ist kein implementierbares Issue; ein Plandokument beschreibt einen Weg und wird erst per `/issues` in Arbeitspakete zerlegt. Ohne das Gate würde eine Session sie zwar korrekt ablehnen, aber der Runner kann diese Ablehnung nicht von einem Fehlschlag unterscheiden — die Session ist verbrannt und der Kommentar am Board irreführend. Beim Plandokument wäre es schlimmer: Es trüge keinen Ablehnungsgrund in sich und würde umgesetzt, und das sähe am Board wie ein Erfolg aus.

**Start:**

```bash
node .claude/kit/night.mjs --dry-run   # zeigt, was laufen würde — startet nichts
node .claude/kit/night.mjs             # echter Lauf
```

Flags: `--max <N>` (Session-Limit pro Nacht, Default 10), `--model <id>` (Default `claude-opus-5`), `--timeout-min <N>` (Zeitlimit pro Runde, Default 60), `--dry-run`, `--no-checks-ok` (Start, ohne dass eine Prüfung die Paketstufe trägt — der Runner verweigert sonst, denn nachts ohne Gate zu implementieren ist riskant; eine Liste aus lauter `push`- und `merge`-Prüfungen ist für die Umsetzung dasselbe wie eine leere), `--yolo` (siehe Permissions), `--label <name>` (Routing-Label, Default `kit:nightrun`; `none` schaltet den Filter ab), `--verbose` (Live-Verlaufsprotokoll), `--help`. Dazu das Config-Feld `formatFixCommand` (siehe unten) — kein Flag, weil es projektspezifisch ist.

**Routing-Label — welche Ready-Issues der Nachtlauf bearbeitet.** Standardmäßig verarbeitet der Runner aus Ready nur Issues mit dem Label `kit:nightrun`; alle anderen bleiben unangetastet liegen (kein Verschieben, kein Kommentar). So markierst du auf **einem** Board gezielt die Teilmenge für den Nachtlauf und behältst den Rest für interaktive Arbeit — ohne ein zweites Board mit eigenem Token, das `Issue #N`-Abhängigkeiten zwischen den Boards unauflösbar machen würde. Das Label ist per `--label <name>` überschreibbar; `--label none` schaltet den Filter ganz ab (dann kommt wie früher strikt das oberste Ready-Issue dran). Ein `--dry-run` weist ungelabelte Issues sichtbar als „übersprungen" aus. Bei **GitLab** sind Labels bereits der Status-Mechanismus — wähle dort einen Routing-Label-Namen, der mit keinem Status-Label kollidiert (der Default `kit:nightrun` mit Namespace-Präfix tut das). **Tragweite:** Wer `night.mjs` bisher ohne Labels nutzte, muss seine Nacht-Issues jetzt mit `kit:nightrun` versehen oder `--label none` setzen — sonst findet der Lauf nichts.

Ohne `--verbose` protokolliert der Runner pro Runde nur Start und Ende — bei einer langen Session sieht man nicht, woran sie gerade arbeitet (`claude -p` gibt erst am Schluss seine Abschlussnachricht aus). Mit `--verbose` liest der Runner den `stream-json`-Output der Session live mit und schreibt kompakte Ereigniszeilen ins Nacht-Log und auf die Konsole — Tool-Aufrufe und Text-Snippets, jeweils mit der Issue-Nummer:

```
[18:24:10]   #401 > Bash: mvn -q verify
[18:25:02]   #401 > Edit: src/main/java/.../ProjectIdeaEventService.java
[18:26:11]   #401 > Claude: Tests grün, ich committe jetzt.
```

Die finale Abschlussnachricht landet wie gehabt zusätzlich im Log; das Streaming ergänzt sie, ersetzt sie nicht.

**Der Ergebnisstand — die Nacht als JSON.** Jeder Lauf legt neben dem Textprotokoll (`.claude/night-run-<datum>.log`) einen maschinenlesbaren Ergebnisstand unter `.claude/night-run-<datum>-<uhrzeit>.json` ab: je Arbeitspaket eine Einheit mit Ausgang, Dauer, Commit und den Kennzahlen der Session (Kosten, API-Dauer, Züge), dazu der Abschluss des ganzen Laufs (`regulaer` oder `harterStopp`, im Stoppfall mit Fehlerklasse und Grund). Als Ausgang einer Einheit kommen vor: `erfolg`, `zurueckgestellt`, `angehalten` (siehe unten), `uebersprungen`, `liegengeblieben` und `harterStopp`. Die Datei wird nach jeder Runde vollständig neu geschrieben, ein abgebrochener Lauf hinterlässt also den Stand bis zum Abbruch. **Verbrauch:** Die Kennzahlen jeder Session tragen neben Kosten, API-Dauer und Zügen die vier Token-Mengen aus der CLI — `eingabeTokens`, `ausgabeTokens`, `cacheErzeugtTokens`, `cacheGelesenTokens`. Jede Einheit summiert sie als `verbrauch` über alle ihre Sessions (auch Salvage und Ketten-Stufen) und nennt ihre Lauf-Art als `art`; der Lauf-Kopf führt `verbrauch` über alle Sessions des Laufs, einschließlich des Vorflugs, und `verbrauchOhneEinheit` als den Teil, der zu keiner Karte gehört. Ein Feld, zu dem nie eine Menge kam, bleibt `null` — eine 0 behauptete, es sei nichts verbraucht worden. `complete` steht auf `false`, solange der Lauf läuft, und wird nur am regulären Ende `true`. Die Uhrzeit gehört in den Namen, weil das Textprotokoll eine Tagesdatei zum Anhängen ist, JSON aber nicht angehängt werden kann — der zweite Lauf eines Tages überschriebe sonst den ersten. **Der einzige Ausschluss ist `--dry-run`**: Ein Dry-Run arbeitet nichts ab und hat nichts zu berichten.

**Ohne `--verbose` fehlen nur die Kennzahlen, nicht die Datei.** Ohne das Flag fordert der Runner die ausführliche Session-Ausgabe gar nicht erst an und kommt an Kosten, API-Dauer und Züge nicht heran — die Einheiten führen dann `kennzahlen: null`. Damit das nicht als „diese Session hatte nichts zu messen" gelesen wird, trägt der Lauf-Kopf das Feld `kennzahlenHinweis`, das den Grund einmal nennt; bei `--verbose` fehlt das Feld ganz. Früher hing die ganze Datei am Flag — das kostete die Auswertung in genau der Nacht, in der jemand es vergessen hatte, und das ist die Nacht, in der man sie braucht: **Der Grund eines Abbruchs wiegt mehr als die Kennzahlen eines glatten Laufs.** Zur Konsequenz gehört, dass auch ein Lauf, der schon am **Vorflug** scheitert — Crash-Rest in *In progress*, unsauberer Working Tree, leere `buildChecks`, Reviewer-Vorflug —, einen Ergebnisstand mit `abschluss: "harterStopp"` und Fehlerklasse hinterlässt, obwohl er kein einziges Paket abgearbeitet hat. Genau dort sucht man morgens den Grund.

**Der Grund eines harten Stopps steht als Text in der Datei.** Die Fehlerklasse sagt, *wo* es gerissen ist (`harterStopp`, `umgebung`, `tracker`, `zustand`) — der Grund sagt, *was* passiert ist, und zwar wörtlich mit dem Satz, der ohnehin ins Textprotokoll geht. Er steht an **genau einer Stelle**: am Feld `grund` der betroffenen Einheit, auf die der Lauf über `fehlerEinheit` verweist. Nur der Vorflug-Stopp kennt keine Karte — er läuft, bevor ein Kandidat gezogen ist —, und sein Grund steht deshalb am `fehlerText` des Laufs, `fehlerEinheit` bleibt dort leer. Bei einem unsauberen Arbeitsbaum nennt der Grund zusätzlich die liegengebliebenen Dateien; **ab dem elften Eintrag** wird auf die Anzahl und die ersten zehn gekürzt, in der Reihenfolge von `git status --porcelain`. Vorher musste man für genau diese Frage das Textprotokoll durchsuchen oder eine Sitzung dafür starten. Bleibt ein Grund wider Erwarten aus, trägt der Lauf den zuletzt gemerkten Stopptext samt einem Vermerk, dass die Übergabe gerissen ist, sonst einen Ersatztext mit der Bitte um Meldung — leer bleibt das Feld nie.

**Ein Lauf ohne Arbeit nennt seinen Grund.** Endet eine Nacht, ohne dass ein einziges Arbeitspaket an der Reihe war, trägt der Lauf-Kopf dafür das Feld `noWorkReason` — wörtlich mit dem Satz, der ohnehin ins Textprotokoll geht: `Ready ist leer — nichts zu tun.` in der Umsetzungsnacht, `Keine Kette zu fahren — nichts zu tun.` bei `--kette`. Ohne das Feld sah eine leere Nacht in der Auswertung aus wie eine abgebrochene: keine Einheit, kein harter Stopp, kein Hinweis darauf, dass schlicht nichts zu tun war. Ein Lauf mit Arbeit trägt es nicht.

**Einlieferung ans Board.** Mit `issueTracker: toolbox` liefert der Runner den Ergebnisstand fortschreibend an kanban-kit ein — nach jeder Einheit und am Ende, über `board.mjs nightrun melden` an `POST /api/kanban/night-runs`, mit dem projektgebundenen Token. **Die erste Meldung geht raus, bevor das erste Arbeitspaket dran ist:** unmittelbar nachdem der Ergebnisstand angelegt ist, mit leerer Paketliste und `complete: false`. Ein Lauf, der schon im Vorflug oder in der ersten Session stehenbleibt, ist damit am Board zu sehen — vorher war er von einer Nacht, die nie gestartet wurde, nicht zu unterscheiden. Die Startmeldung erzeugt keine Protokollzeile, und im Dry-Run entfällt sie wie jede andere Meldung. kanban-kit ersetzt denselben Lauf bei jeder Meldung; ein harter Stopp hinterlässt die Nacht dort mit `complete: false`. Scheitert die Einlieferung, endet der Lauf **nicht** als Fehlschlag: Das Protokoll nennt den Grund, und die Datei bleibt der Rückfall. Mit jedem anderen Tracker entfällt die Einlieferung mit einer Protokollzeile.

Das **Textprotokoll** — also die `.log`-Datei von oben — bleibt unverändert daneben liegen und ist weiterhin der Weg für den, der ins Detail will; der Ergebnisstand ersetzt es nicht, er ergänzt es um eine auswertbare Form. Zwei Versionsangaben stehen in der Datei: `schemaFassung` als erstes Feld nennt die Fassung des Formats — die braucht, wer die Datei auswertet — und `erzeugtVon` den Kit-Stand, der sie geschrieben hat, für den, der beim Nachsehen wissen will, welcher Runner am Werk war. Getrennt geführt, weil ein Kit-Release die `schemaFassung` nicht ändert und eine Formatänderung nicht auf ein Release wartet. Als unsauberen Working Tree wertet der Runner die Datei nicht — sie muss nicht committet werden; wessen `.gitignore` `.claude/*` nicht führt, sieht sie morgens trotzdem in `git status` stehen.

**Was geprüft wurde — und was nicht.** Die Sessions prüfen bereichsbezogen (siehe [Bereichsbezogene Prüfungen](#bereichsbezogene-prüfungen-checkareas)), und die Auslassungen sind an **zwei** Stellen sichtbar: im **Abschlussbericht am Arbeitspaket**, wo die Session gelaufene und ausgelassene Prüfungen jeweils mit Grund aufführt, und im **Lauf-Bericht des Durchgangs** — dort je Session eine Zeile und darunter eine Summenzeile über den ganzen Lauf. Eine Session ohne Prüfung erscheint ausdrücklich als „ungeprüft", ein Paket ohne Änderungen als „leeres Paket"; nichts davon versteckt sich hinter einer leeren Liste. Der Runner liest das nicht aus dem Abschlussbericht, sondern aus der Zusammenfassung, die `checks.mjs` in `.claude/checks-summary.json` hinterlässt: Was die Maschine auswertet, geht hier nirgends durch von einem Modell formulierten Text.

**Nachtlauf gegen ein anderes Board (Toolbox/kanban-kit).** Läuft dein Projekt gegen einen kanban-kit-Tracker, kannst du den ganzen Nachtlauf auf ein eigenes Night-Board umschalten: Token in der Admin-UI erzeugen und an das Night-Board binden, als zweite gitignorete Datei neben dem normalen `tokenFile` ablegen (z. B. `.claude/tbx-night.token`) und den Runner mit `TBX_TOKEN` pro Aufruf starten:

```bash
TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs
```

Das funktioniert, weil `TBX_TOKEN` die höchste Stufe der [Token-Precedence](#toolbox-privates-setup) ist und die Umgebungsvariable über die ganze Prozesskette vererbt wird: vom Runner an seine eigenen `board.mjs`-Aufrufe **und** an jede Headless-Session, deren `board.mjs`-Aufrufe sie wiederum erben. Der gesamte Lauf wechselt damit das Board — Ready-Quelle und alle Rückmeldungen (move, comment). Ein Split („Issues von Board B ziehen, auf Board A melden") ist bewusst nicht möglich: Das Board ist das einzige Koordinationssignal des Runners. Wichtig: `TBX_TOKEN` nur so, pro Aufruf, setzen — nie dauerhaft exportieren (etwa in `.zshrc`), sonst gewinnt es in **jedem** Projekt gegen dessen `tokenFile`. Das alles gilt nur für den Toolbox-/kanban-kit-Tracker; bei GitHub und GitLab ist das Board pro Repo über die Config getrennt (`github.projectNumber` bzw. Status-Labels), ein Umschalten pro Aufruf gibt es dort nicht.

**Modell-Angabe im Aktivitätsverlauf (kanban-kit).** Der Runner setzt jeder Session `KIT_AGENT_MODEL` auf das Modell, mit dem sie tatsächlich startet — das ist seit v1.54 nicht mehr zwingend der Wert von `--model`, sondern das Modell der jeweiligen Karte (siehe unten). Die Variable wird über dieselbe Prozesskette vererbt wie `TBX_TOKEN` — bis in die `board.mjs`-Aufrufe der Session — und der Adapter hängt sie als Header `X-Agent-Model` an jeden Board-Request. Im Aktivitätsverlauf steht dann neben der Herkunft auch, mit welchem Modell nachts gearbeitet wurde. Das ist ausdrücklich eine **Selbstauskunft des Clients, kein Nachweis**: Session und Token verifiziert der Server, das Modell nicht — die Board-Seite kennzeichnet den Wert entsprechend („lt. Angabe"). Interaktive Sessions setzen die Variable nicht und machen dadurch keine Angabe; keine Angabe ist ehrlicher als eine geratene. Serverseitig ausgewertet wird der Header nur von kanban-kit; andere Tracker ignorieren ihn.

**Woher das Modell einer Session kommt.** Bis v1.53 lief jede Session einer Nacht mit demselben Modell: `--model`, einmal für den ganzen Lauf. Stand am Arbeitspaket eine Empfehlung, hatte sie keine Wirkung. Seit v1.54 gilt eine feste Reihenfolge — Modellname der Karte, dann Aufgabenstufe, dann Modell des Laufs:

1. Trägt der Body der Karte eine Zeile `Empfohlenes Modell: <name>` **und** steht `<name>` in `night.modelle`, startet die Session mit diesem Modell. Derselbe Wert geht in `--model` und in `KIT_AGENT_MODEL`. Der Modellname gewinnt gegen eine gleichzeitig gesetzte `Aufgabenstufe:`-Zeile; trägt eine Karte beides, bleibt die Stufe ohne Wirkung, und der Grund im Ergebnisstand vermerkt die doppelte Angabe.
2. Sonst, und nur wenn `night.stufen` aktiv ist (mindestens eine Stufe belegt) und die Karte eine `Aufgabenstufe:`-Zeile trägt, gilt die Stufe: Der Runner sucht ab dieser Stufe aufwärts — **leicht → mittel → schwer** — die erste belegte **und** startbare Stufe. Eine unbelegte oder nicht startbare Stufe wird übersprungen, nie unterschritten: Eine Aufgabe, für die die vorgesehene Stufe fehlt, läuft lieber mit einem stärkeren Modell als mit einem schwächeren.
3. Sonst gilt das Modell des Laufs (`--model`).

**`night.modelle` ist die einzige Prüfung — und sie ist ein Sicherheitsgatter, kein Komfort.** Ohne sie wanderte ein Wert aus einem Issue-Body unbesehen in die Kommandozeile; ein Paket mit `Empfohlenes Modell: --dangerously-skip-permissions` wäre ein Angriff über eine Karte. Deshalb wird gegen eine **Liste** verglichen und nicht gegen ein Muster: Ein Muster lässt sich erweitern, eine Liste nicht. Ein Wert mit führendem Bindestrich oder mit Leerzeichen gilt gar nicht erst als Kandidat, und das Schema weist ihn schon bei der Config-Prüfung ab. Dieselbe Liste gilt für eine Stufe mit `modell`: Ein Stufen-Modellname muss ebenfalls in `night.modelle` stehen, sonst weist die Konfigurationsprüfung ihn ab — zwei getrennte Listen könnten sonst auseinanderlaufen. Eine Stufe mit `kommando` prüft stattdessen, ob das erste Wort der Kommandozeile über dieselbe Shell auffindbar ist, die später startet, und ob die Plattform kein Windows ist (eine Kommando-Stufe braucht eine POSIX-Shell).

Ein Kartenname **außerhalb** der Liste ist kein Fehlschlag: Die Session läuft mit dem Modell des Laufs, und die Einheit im Ergebnisstand trägt `modellHerkunft: "lauf"` samt `modellGrund` mit dem abgewiesenen Namen. Eine fehlende Zeile und eine leere Liste führen ebenfalls zum Lauf-Modell, dann ohne Grund — eine fehlende Empfehlung ist der Normalfall und kein Befund. Ein Modell, das trotz gültigen Namens nicht startet, bleibt dagegen ein Fehlschlag wie jeder andere.

**Startfehler auf der höchsten Stufe.** Die Startbarkeit einer Stufe prüft der Runner **vor** dem ersten Arbeitsschritt jedes Pakets neu. Scheitert die vorgesehene Stufe, weicht er nach oben aus wie oben beschrieben; scheitert das auch auf der höchsten Stufe (`schwer`), gibt es keine Ausweichmöglichkeit mehr. Dann startet **keine** Session — ein stiller Rückfall auf das Modell des Laufs wäre falsch, denn wer eine Stufe setzt, will das Paket auf dieser Ebene laufen lassen. Das Paket gilt als Fehlschlag, bekommt einen Kommentar mit dem Grund und wandert zurück ins Backlog.

**Der Vorflug.** Vor der ersten Runde einer Nacht prüft der Runner einmal ohne Netz, ob jede **belegte** Stufe startbar ist, und schreibt bei einer nicht startbaren Stufe eine Warnung ins Protokoll. Das hält die Nacht nicht auf — es ist ein früher Hinweis, dass einzelne Pakete später ausweichen oder scheitern werden, keine Startbedingung für den ganzen Lauf. Bei nicht aktiver Einstellung schreibt der Vorflug keine Zeile.

**Die Vorschau.** `night.mjs --dry-run` nennt zu jedem Ready-Issue, welches Modell tatsächlich starten würde und woher — `(Karte)`, `(Stufe <name>)` oder `(Lauf)` —, samt Ausweich-Hinweis, wenn die eigene Stufe der Karte unbelegt ist und eine startbare Stufe erst weiter oben gefunden wurde. Ein Paket ohne startbare Stufe erscheint darin ausdrücklich als „würde nicht starten", nie als laufende Session.

**Ein durchgerechnetes Beispiel mit einem lokalen Modell.** Ein Projekt betreibt für leichte Aufgaben ein eigenes, lokal gehostetes Modell über ein Kommandozeilen-Programm statt einer Claude-Modell-ID:

```json
{
  "night": {
    "modelle": ["claude-opus-5", "claude-sonnet-5"],
    "stufen": {
      "leicht": {
        "kommando": "mein-lokal-runner",
        "name": "lokal-llama"
      }
    }
  }
}
```

Trägt ein Ready-Issue `Aufgabenstufe: leicht`, startet der Runner statt der `claude`-CLI `mein-lokal-runner` und übergibt ihm den Auftrag (`/implement-next #N`) als Argument. `KIT_AGENT_MODEL` trägt dabei den Wert aus `name` (`lokal-llama`) — im Kommando-Zweig gibt es keinen Claude-Modellnamen, das Feld ist dort eine reine Selbstauskunft des Programms. Einrichtung und Betrieb dieses Programms sind Sache des Projekts, nicht des Kits; das Kit startet nur den Prozess. Damit die Karte danach wie jede andere behandelt wird, muss das Programm dasselbe liefern wie eine reguläre Session: einen lokalen Commit, das Issue in In review und einen Eintrag im Abschlussbericht (Kriterium 6) — der Runner wertet ausschließlich Board-Zustand und Working Tree aus, ihm ist gleich, welches Programm sie hergestellt hat.

Die **Salvage-Session** eines Pakets läuft mit demselben Modell wie dessen reguläre Runde: Sie prüft deren Zwischenstand, und die Empfehlung galt der Karte, nicht der Betriebsart. Die **Umsetzungsstufe der Nacht-Kette** zieht ihre Arbeitspakete durch dieselbe `laufeRunde` wie die Umsetzungsnacht — für sie gilt der Stufenweg deshalb ebenso. Für Fachplan, Plan und Zerlegung der Kette (`/techplan`, `/issue-review`, `/issues`) gilt dagegen weiterhin das Modell des Laufs: Sie hängen an keiner einzelnen Karte.

Ein Projekt **ohne `night.stufen`** merkt von alldem nichts: Planung, Pakete, Nachtlauf, Vorflug und Bericht verhalten sich wie zuvor — jede Karte trägt weiterhin nur `Empfohlenes Modell:`, und die Modellwahl bleibt bei den zwei Fällen Karte/Lauf.

Die Liste `night.modelle` ist **geordnet**, absteigend nach Stärke: erster Eintrag das stärkste, letzter das schnellste Modell. Daraus leitet `/issues` ab, was es einem Arbeitspaket empfiehlt.

**Permissions.** Unbeaufsichtigt heißt: niemand beantwortet Permission-Dialoge. Der Runner startet die Sessions deshalb mit `--permission-mode acceptEdits`; alles Weitere erlaubst du gezielt über eine Allowlist in `.claude/settings.json` des Projekts. Vor der ersten Session prüft der Runner in jeder Betriebsart, ob `.claude/settings.json`, `.claude/settings.local.json` und `~/.claude/settings.json` — soweit vorhanden — gültiges JSON sind, und stoppt bei einem Fehler hart mit Pfad und Parser-Meldung (im Dry-Run nur berichtet): Eine ungültige Datei setzt alle ihre Einstellungen außer Kraft, und nachts sähe man davon nur eine Genehmigungsabfrage, die niemand beantwortet. Die Allowlist z. B.:

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

**Der vierte Ausgang: `angehalten`.** Eine Implementierungs-Session entscheidet, statt zu fragen: Was beim Umsetzen unklar ist und nicht in der Stopp-Klasse aus `CLAUDE-workflow.md` steht, wird entschieden und im Abschlussbericht unter `### Entscheidungen` protokolliert. Taucht dagegen eine Frage der Stopp-Klasse auf, wählt die Session nicht, sondern **hält an**: Sie nimmt ihren eigenen Anteil an den Änderungen zurück, zeichnet das Issue mit `kit:klaeren`, benennt die Frage als Board-Kommentar und schiebt es nach Backlog. Der Runner erkennt das am Kommentar, schreibt eine eigene Log-Zeile und **läuft weiter**.

Dieser Ausgang ist von den beiden benachbarten zu unterscheiden, und genau dafür hat er einen eigenen Namen:

| Ausgang | Was passiert ist | Wer kommentiert und bewegt | Folge für den Lauf |
|---|---|---|---|
| `zurueckgestellt` | die Session hat die Aufgabe nicht fertigbekommen | der Runner | weiter mit dem nächsten Issue |
| `angehalten` | die Aufgabe ist lösbar, aber eine Entscheidung fehlt | die Session selbst — der Runner tut hier nichts | weiter mit dem nächsten Issue |
| `harterStopp` | die Umgebung oder der Arbeitsbaum ist kaputt | keiner, das Issue bleibt unangetastet | der Lauf endet |

Ein Halt ist **kein Fehlschlag**: Die Session hat richtig gehandelt, indem sie nicht geraten hat. Deshalb steht er im Ergebnisstand als eigener Zähler neben `erfolg`, `zurueckgestellt` und `fehlschlag` — wer die wartenden Entscheidungen morgens in der Rückstellungszahl suchen müsste, fände sie nicht. Der Weg nach vorn führt über `/fachplan #T`: Der Skill nimmt den angehaltenen Task samt Entscheidungskommentar als Eingang und macht eine fachliche Anforderung daraus. Das `kit:klaeren` nimmt dabei ausschließlich der Mensch ab.

**Eine wartende Vorhaben-Notiz ist kein Rest.** Legt eine Nacht-Session mit `/techplan` eine Notiz ab, entsteht sie als `.claude/vorhaben-wartend-<k>.md` — im ignorierten `.claude/`, also außerhalb dessen, was der Rest-Guard misst. Sie liegt am Morgen noch da und gehört dorthin: Abgeholt wird sie erst beim nächsten `push main`, und der ist ein menschlicher Stop-Punkt. Läge die Notiz stattdessen unter `specs/`, wäre jeder nächtliche Plan ein unsauberer Working Tree und damit ein harter Stopp.

**Salvage — wenn die Arbeit fertig ist, das Board es aber nicht weiß.** Eine Headless-Session hat keinen Folge-Turn. Startet sie einen langen Check im Hintergrund und beendet ihren Turn, bevor das Ergebnis da ist, ist es verloren — das Board zeigt einen Fehlschlag, obwohl die Arbeit vollständig war. Bevor der Runner bei „nicht in In review UND dirty" hart stoppt, führt er deshalb die `buildChecks` selbst aus — und zwar die Prüfungen der **Paketstufe**, diese aber **ohne bereichsbezogene Auswahl**. Das ist kein Versehen: Die beiden Auswahlen beantworten verschiedene Fragen. Nach einem sauberen Arbeitspaket lautet die Frage „hat diese Arbeit etwas kaputtgemacht?", und dafür genügen die berührten Bereiche. Beim Retten lautet sie „ist dieser unklare Zwischenstand überhaupt brauchbar?" — niemand weiß dann, was die abgebrochene Session angefasst hat, also wird über alle Bereiche gefragt. Die Stufe bleibt davon unberührt: Auch beim Retten geht es um ein Arbeitspaket, und Prüfungen mit `stufe` `push` oder `merge` sind erst beim Veröffentlichen fällig — liefen sie hier mit, wartete jeder Rettungsversuch auf sie. Sind die Checks grün, bekommt **genau eine** Salvage-Session pro Issue die Chance, den Zwischenstand gegen das Issue zu prüfen, zu committen und das Board zu bewegen (Zeitlimit 10 Minuten; sie führt keine Builds mehr aus). Rote Checks oder ein gescheiterter Versuch führen zum harten Stopp, jeweils mit eigener Log-Zeile. Die Vorprüfung merged dabei den `env`-Block aus `.claude/settings.json` und `.claude/settings.local.json` in ihre Umgebung — sonst fehlen ihr projektspezifische Variablen (etwa für Testcontainers), die sonst nur Claude Codes eigene Bash-Aufrufe bekommen, und sie meldet ein falsches Rot.

**Trägt der Salvage nicht, sind es drei Endzustände — nicht einer.** Alle drei enden im harten Stopp, aber sie verlangen morgens drei verschiedene Griffe. Protokollzeile, Board-Kommentar und der `grund` des Ergebnisstands nennen sie deshalb beim Namen:

| Endzustand | Was der Runner vorgefunden hat | Was daran zu tun ist |
|---|---|---|
| `SALVAGE-VERSUCH gescheitert` | kein neuer Commit, Karte nicht bewegt | die Session hat nichts hinterlassen; die Reste im Arbeitsbaum stehen im Grund |
| `SALVAGE UNVOLLSTAENDIG` | neuer Commit, Karte nicht bewegt | die Arbeit liegt lokal — der Commit-Hash und die liegengebliebenen Pfade stehen dabei, nur der Board-Zug fehlt |
| `SALVAGE WIDERSPRUECHLICH` | Karte in In review, Arbeitsbaum unsauber | die Karte behauptet mehr, als committet ist; die betroffenen Pfade stehen dabei |

Ob committet wurde, sagt der Vergleich des Commit-Hashes vor und nach der Salvage-Session: Vor der regulären Runde ist der Arbeitsbaum sauber, ein neuer Commit ist damit die einzige Spur, die sie sicher hinterlässt. **Das Board bewegt der Salvage erst bei sauberem Arbeitsbaum** — seine Anweisung schreibt die Reihenfolge vor: committen, `git status --porcelain` leer sehen, dann erst ziehen. Ohne sie wäre der dritte Fall die Regel statt die Ausnahme.

**Damit es gar nicht erst zum Salvage kommt.** Der Rettungsgriff behandelt den Schaden, nicht die Ursache — und er trug dreimal nicht, weil die Checks danach rot waren. Seit v1.54 setzt der Runner deshalb zwei Dinge davor:

- **Das `Monitor`-Werkzeug ist für Implementierungs-Sessions gesperrt** (`--disallowedTools Monitor`), und ihr Bash-Zeitlimit steht auf dem Rundenzeitlimit (`BASH_MAX_TIMEOUT_MS`, `BASH_DEFAULT_TIMEOUT_MS`). `Monitor` ist das Werkzeug, mit dem eine Session auf einen eigenen Hintergrundlauf wartet — und genau damit beendet sie ihren Zug. Ohne das Werkzeug bleibt ihr der Vordergrund-Aufruf, dessen Ergebnis sie noch verwerten kann; ohne das gehobene Zeitlimit stürbe sie dabei nach zehn Minuten an der Uhr statt am Code. Das ist eine Leitplanke, keine Bitte: Die Anweisung, einen Hintergrund-Check aktiv abzuwarten, steht seit Langem im `local-check`-Skill und stand im Kontext genau der Sessions, die trotzdem wartend endeten.
- **Der Runner misst erst, wenn kein Prozess der Session mehr läuft.** Nach dem Ende einer Session wartet er auf ihre Prozessgruppe, höchstens bis zum Rest des Rundenzeitlimits. Sonst startet die Salvage-Vorprüfung ihren eigenen Build neben einem noch laufenden — zwei gleichzeitige Testcontainers-Läufe reißen einander die Ressourcen weg, und das Rot sagt nichts über den Code. Läuft nach Ablauf der Frist noch etwas, steht ein Hinweis im Protokoll und der Lauf geht weiter.

**Die wartende Sitzung.** Für jede unbeaufsichtigte Sitzung gilt seit v2.0.3 die Regel: **Keine Session endet mit laufender eigener Arbeit.** Sie wartet auf das Ergebnis der langen Arbeit, die sie angestoßen hat, oder bricht diese ab und meldet den Abbruch als Fehlschlag. Hintergrundarbeit bleibt dabei ausdrücklich erlaubt; unzulässig ist allein das Aufhören, während sie noch läuft. Tut eine Sitzung es doch, sah das vorher aus wie ein reguläres Ende ohne Commit — also wie Aufgeben, obwohl die Arbeit womöglich fast fertig war.

**Erkannt wird am Schlusstext**, nicht am Werkzeug und nicht an der Zeit: Wendungen wie „warte auf", „läuft noch", „im Hintergrund" oder „sobald … fertig ist". **Das Warten auf einen Menschen zählt nicht** — ist im Schlusstext von einer Antwort, einer Rückmeldung, einer Freigabe, einem GO, einer Klärung oder einem Review die Rede, hat die Sitzung nichts verloren: Ihre Frage steht am Board, und der Halt-Weg oben hat sie schon verbucht. Gelesen wird ausschließlich der Schlusstext; eine Wartemeldung mitten im Lauf bleibt folgenlos, denn wer später fertig wird, sagt zum Schluss etwas anderes.

**Was der Runner dann tut.** Die Runde bekommt ihren eigenen Grund — dieselbe Zeile in Protokoll, Board-Kommentar und `grund` des Ergebnisstands, siehe die Tabelle unten. An das Arbeitspaket geht ein Kommentar unter dem Anker `## Nachtlauf: wartende Sitzung`: der Fall, der zuletzt bekannte Stand (der Schlusstext, ab 2.000 Zeichen gekürzt) und, sofern welche liegen, die Reste im Arbeitsverzeichnis. Die Einheit im Ergebnisstand trägt `wartendBeendet: true`. Am Ablauf ändert sich nichts: Bei sauberem Arbeitsbaum geht das Paket wie bei jedem Fehlschlag zurück ins Backlog und der Lauf läuft weiter. Die nächste Session, die das Paket zieht, nennt den Vermerk, statt stillschweigend auf halbem Weg weiterzumachen.

**Bei unsauberem Arbeitsbaum kommt der Salvage zuerst.** Rettet er die Runde, bleibt es dabei — dann war nichts verloren, und ein zweites Urteil über denselben Vorgang wäre eine zweite Wahrheit. Ist er nicht möglich (rote Checks) oder gescheitert, treten Grund, Vermerk und `wartendBeendet` hinzu; beim gescheiterten Salvage steht der Grund der wartenden Sitzung **vor** dessen Endzustand aus der Tabelle oben, denn es sind zwei Vorgänge: warum die reguläre Runde nichts hinterlassen hat, und was der Salvage vorgefunden hat.

**In der Nacht-Kette** endet eine Stufen-Session mit wartendem Schlusstext als `abgebrochen`, mit demselben Grund, und ihr Vermerk hängt am Dokument der Stufe — am Plan, am Paket. Einzige Ausnahme ist die Stufe `abdeckung`: Ihre Auskunft *ist* ein Text über laufende Arbeit, und eine Erkennung dort verwürfe den Befund genau dann, wenn er etwas zu sagen hat.

**Gezählt wird sie.** `aufwand.mjs` führt die wartend beendeten Sitzungen als eigene Größe und nennt sie im Befund in einer eigenen Zeile — auch bei null, und dann ausdrücklich als Null: Der Fall ist selten, und ein Schweigen ließe offen, ob er nicht eintrat oder nicht gezählt wurde.

**Der harte Stopp nennt den Grund, nicht nur den Zustand.** Bis v1.53 stand im Protokoll „nicht in In review UND Working Tree dirty" — das ist die Folge. Wer morgens sichtet, unterscheidet jetzt fünf Fälle mit fünf verschiedenen nächsten Schritten:

| Präfix im Protokoll | Was passiert ist |
|---|---|
| `Grund: Session regulaer beendet ohne Commit (end_turn)` | Die Session ist normal zu Ende gegangen, ohne fertig zu werden |
| `Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden` | Die Session hat eine lange Arbeit angestoßen und darauf gewartet — headless gibt es keinen Folge-Turn, siehe oben |
| `Grund: Session am Zeitlimit beendet` | Das Paket war zu groß für die Runde |
| `Grund: Session mit is_error beendet` | Abbruch |
| `Grund: Pflichtcheck rot — <Kommando> (Session)` bzw. `(Vorpruefung des Runners)` | Arbeit am Code; das rote Kommando und die letzten 15 Zeilen seiner Ausgabe stehen dabei |

Der Grund steht im Protokoll, im Board-Kommentar und im `grund` des Ergebnisstands — dieselbe Zeile an allen drei Orten. Damit `stop_reason` überhaupt vorliegt, fordert der Implementierungslauf die Stream-Ausgabe seit v1.54 **immer** an, auch ohne `--verbose`; das frühere Feld `kennzahlenHinweis` im Ergebnisstand ist damit entfallen.

**Plattform-Shell für `buildChecks` und `formatFixCommand`.** Beide Werte sind frei konfigurierte Kommandozeilen und brauchen deshalb zwingend eine Shell — anders als die festen Kommandos des Board-Adapters, der seit v1.27 ganz ohne Shell auskommt. Der Runner startet sie in der Shell der jeweiligen Plattform: `/bin/sh` unter macOS und Linux, die ComSpec-Shell (im Regelfall `cmd.exe`) unter Windows. Bewusst nicht PowerShell — der Wert ist eine Nutzer-Konfiguration, und `cmd.exe` ist das, was beim Eintragen eines Build-Kommandos unter Windows erwartet wird; PowerShell hätte zudem eine eigene Operator-Syntax (kein `&&` vor Version 7). **Folge:** Deine `buildChecks` sind damit potenziell plattformspezifisch. Ein `mvn verify` oder `npm test` läuft überall; eine Verkettung mit `&&`, eine Pipe oder eine Umleitung wie `2>/dev/null` verhält sich unter `cmd.exe` anders oder gar nicht. Wer dasselbe Projekt auf beiden Welten nachts laufen lässt, hält die Kommandos am besten einfach und ohne Shell-Operatoren.

**`formatFixCommand` — ein Formatverstoß darf keinen Lauf kippen.** Setzt du in der `workflow.config.json` ein Kommando, das Formatierung mechanisch repariert (`"formatFixCommand": "mvn spotless:apply"`, für Frontends etwa `"npx prettier --write ."`), dann läuft es bei roten Checks in der Salvage-Vorprüfung **genau einmal**, und die Checks werden **genau einmal** wiederholt. Werden sie dadurch grün, geht der Lauf weiter und das Protokoll weist den Eingriff mit `FORMAT-FIX angewendet` aus — kein stiller Eingriff. Bleiben sie rot, war das Format nicht die Ursache und es bleibt beim harten Stopp. Hintergrund: Ein einzelner falsch umbrochener Javadoc-Kommentar hat einmal einen kompletten Nachtlauf beendet, obwohl die Arbeit korrekt war. Ein Formatverstoß ist deterministisch behebbar und sagt nichts über die fachliche Qualität — ein fehlgeschlagener Test dagegen schon, und der bleibt unverändert ein harter Stopp. Ohne das Feld ändert sich nichts.

### Zweiter Modus: die Nacht-Kette

**Seit dem Prozess-Umbau (September 2026) gibt es zwei Betriebsarten: die Umsetzungsnacht oben und die Nacht-Kette.** Die früheren Modi Review und Erzeugung sind mit Stufe 2 des Umbaus aus dem Runner entfallen; die Prüfkette dahinter — Marker als Gate, Fundklassen, Synthese, Routing-Label je Stufe — ging schon mit Stufe 1 (Umsetzungsplan in `docs/prozess-umbau-stufe-1.md`). Die Kette ersetzt beide: Ein Fachplan geht abends hinein, morgens liegen ein geprüfter Plan, die Arbeitspakete und ein Bericht am Fachplan vor. Was danach mit den Paketen geschieht, entscheidet die **Variante** des Fachplans: Unter **Variante A** implementiert die Kette **nichts** — die Pakete bleiben im Backlog, das GO nach Ready ist weiterhin deins, und die Umsetzung ist die Nacht danach. Unter **Variante B** zieht die Kette die Pakete selbst nach Ready und setzt sie in derselben Nacht um — dein GO liegt dann bereits in der Kennzeichnung des Fachplans, nicht mehr im einzelnen Zug nach Ready.

**Die Geste:** das Label `kit:night` am gegroomten `[Fachlich]`-Issue im Backlog. Der Runner **verbraucht es beim Start** der Kette — jedes Setzen autorisiert genau eine Kette; ein Abbruch führt zu einem Bericht mit Grund und einer neuen Geste, nicht zur stillen Wiederholung. Der Labelname kommt aus `night.kette.label` und muss am Board einmal angelegt sein (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`).

**Die Pruefung als Voraussetzung.** Das Kettenlabel allein genügt nicht mehr: Der Fachplan muss zu Beginn des Laufs zusätzlich das Label `review:fertig` tragen — den Weg dahin geht `/issue-review <Nummer>`, das die Anforderung prüft und `review:fertig` setzt. Fehlt es, wird der Fachplan übersprungen: Er behält sein Kettenlabel, die Geste ist nicht verbraucht, und er bekommt einmal den Kommentar mit dem Anker `## Kette nicht gestartet: Pruefung fehlt`, der den Grund und den Weg über `/issue-review` nennt. Das ist ein anderer Fall als der Kommentar `Kette nicht gestartet` bei gescheitertem Reviewer-Vorflug: Dort waren die Reviewer nicht erreichbar, hier fehlt die Prüfung der Anforderung selbst — beide Kommentare beginnen mit demselben Text, sind aber an ihrem Anker zu unterscheiden. Wie `kit:night` und `kit:durchziehen` muss `review:fertig` am Board einmal angelegt sein; trägt keine einzige Karte es, meldet der Runner das im Protokoll.

**Die Variante:** ein zweites, unabhängiges Label am selben Fachplan, `kit:durchziehen` (`night.kette.varianteBLabel`), kennzeichnet ihn für Variante B. Anders als `kit:night` wird es **nicht verbraucht** — es bleibt am Fachplan stehen, denn es kennzeichnet den Fachplan selbst und nicht nur den einen Lauf; eine spätere Kette zum selben Fachplan (etwa nach `angehalten`) liest es erneut. Fehlt es, gilt Variante A. Wie `kit:night` muss es am Board einmal angelegt sein.

**Start:**

```bash
node .claude/kit/night.mjs --kette --dry-run   # Kandidaten, Reviewer-Stand, Budgets — startet nichts
node .claude/kit/night.mjs --kette             # echter Lauf
```

Flags: `--max <N>` zählt hier **Ketten** (Default 3); `--model <id>` und `--verbose` wie oben. `--label` gilt hier nicht — die Kette liest ihr Label aus der Config, und `--kette --label` wird abgewiesen. Die Schalter der entfallenen Modi weist der Runner mit einem Hinweis auf `--kette` ab; ein noch gesetztes altes Routing-Label bekommt eine Protokollzeile, keine Wirkung. Die `buildChecks`-Pflicht entfällt für die Kette: Sie baut nichts und committet nichts.

**Bedingungen:** Ein Kandidat trägt das Label, hat den Titel `[Fachlich]`, steht im **Backlog** und trägt kein `kit:klaeren` — dort wartet eine Antwort, die vorher im Fachplan stehen muss. Was das Label trägt, aber nicht laufen darf, steht mit Grund als `uebersprungen` im Ergebnisstand, und das Label bleibt. Vor der ersten Kette läuft der **Reviewer-Vorflug** wie früher: eine eigene Vorflug-Session prüft die Reviewer und den Tracker in der Umgebung der Sessions, nicht im Runner (siehe Allowlist unten). Scheitert er, bekommt jeder Kandidat den Kommentar `Kette nicht gestartet: <Grund>`, behält sein Label, und der Lauf endet hart — die Geste ist nicht verbraucht, denn es lief nichts. Anders als die Umsetzungsnacht verlangt die Kette **keinen sauberen Arbeitsbaum und keine leere In-progress-Spalte**: Sie arbeitet in einem eigenen Worktree und läuft neben einer Umsetzungsnacht.

**Der Worktree.** Jede Kette bekommt einen `git worktree` unter dem Temp-Verzeichnis (`kette-<repo>-<F>-<stempel>`), in den der Runner `.claude/` der Hauptkopie spiegelt — Kit-Kopie, Skills, Settings, Token —, ohne die Protokolle. Beim lokalen Tracker zeigt die Config im Worktree auf das `issues`-Verzeichnis der Hauptkopie, damit die Karten dort entstehen. Nach der Kette wird der Worktree entfernt; wartende Vorhaben-Notizen holt der Runner vorher in die Hauptkopie, und liegengebliebene Worktrees räumt der nächste Start.

**Der Ablauf je Stufe**, jede mit eigener Session im Worktree und gesetztem `KIT_AGENT_MODEL`:

| Stufe | Session | Ergebnis | wann die Kette hier endet |
|---|---|---|---|
| plan | `/techplan #F` | ein `[Plan]`-Dokument mit `Fachliche Quelle: Issue #F` — bei mehreren das jüngste | kein Plan: `abgebrochen`; Stopp-Frage in `## Offene Fragen`: `angehalten` |
| Formprüfung | `issue check-form`, bei Rot eine Korrektursession mit genau den Verstößen | grüne Form, bis zu `korrekturrunden` Runden je Dokument | weiterhin rot: `abgebrochen` |
| review | `/issue-review #M` — der Prüfer der Stufe `plan` | Marker `Plan-Review:`, Befunde und Einarbeitung als Kommentare am Plan | `kit:klaeren` am Plan: `angehalten` mit der Frage aus dem letzten Kommentar |
| pakete | `/issues #M` | nur Karten mit `Plan: Issue #M` zählen; jede geht durch die Formprüfung | kein Paket und der Kommentar `Kein Eingang für /issues` am Plan: `angehalten`; kein Paket ohne ihn: `abgebrochen` |
| abdeckung | eine lesende Session hält die Pakete gegen den Fachplan | ihr Text — Zuordnung, Ohne Paket, Zuwachs — im Ergebnisstand und im Bericht | nie: Die Abdeckung ist eine Auskunft, kein Tor; fehlt sie, steht der Grund im Bericht |
| umsetzung (nur Variante B) | `/implement-next #P` je Arbeitspaket, wortgleich mit der Umsetzungsnacht | Paket nach Ready gezogen, umgesetzt (In review) oder zurückgestellt; die Session erfährt von der Kette nichts, sie sieht ein reguläres Ready-Paket | Lock `night-umsetzung.lock` bereits gehalten: Stufe ausgelassen, Rückfall auf Variante A; harter Stopp: `abgebrochen`; mindestens ein Paket hält an einer Stopp-Frage: `angehalten` (das Paket trägt `kit:klaeren` bereits selbst, der Fachplan bekommt keinen zweiten Halt) |

Andere neue Karten ohne die Herkunftszeile stehen als „nicht zuordenbar" im Bericht; schreibt die Abdeckungs-Session entgegen ihrem Auftrag am Board, vermerkt der Bericht auch das.

**Ohne Review-Freigabe fällt Variante B auf Variante A zurück.** Trägt das Projekt `issueReview.requiredBeforeReady: true`, prüft die Stufe `umsetzung` jedes Paket mit demselben Gate wie die Umsetzungsnacht — und frisch aus `/issues` geschnittene Pakete tragen noch keinen Review-Marker. Jedes Paket fällt damit aus der Stufe heraus und bleibt kommentiert in Backlog stehen; die Kette endet für diese Nacht wie unter Variante A, mit geprüftem Plan und Paketen im Backlog, ohne Umsetzung. Der Bericht nennt den Grund je Paket.

**Bricht die Review-Stufe ab, nachdem die Befunde schon am Plan stehen**, hinterlässt die Kette dort den Kommentar `## Review unvollstaendig` mit dem Grund des Abbruchs und dem Weg nach vorn (`/issue-review #M` von Hand). Genau diese Lücke trifft ein Abbruch am häufigsten — die Einarbeitung steht am Ende der Stufe —, und ohne Vermerk sieht das Dokument später aus wie ein ungeprüftes: Die Prüfung ist bezahlt, die Befunde stehen am Board, der Body trägt keinen `Plan-Review:`-Marker. Den Ausgang ändert der Vermerk nicht, er bleibt `abgebrochen` mit seinem Grund.

**Drei Ausgänge**, je Kette genau einer: `fertig` (Plan geprüft, Pakete liegen im Backlog), `angehalten` (eine Frage der Stopp-Klasse wartet auf dich) und `abgebrochen` (technisch oder am Budget gescheitert, mit Grund). Abbruchgründe sind: kein Plan oder kein Paket entstanden; Form nach den Korrekturrunden weiterhin verletzt; Zeitbudget einer Stufe erschöpft; Kostenbudget überschritten — geprüft **nach** der Session, nie mittendrin, denn ein halb geschriebenes Dokument wäre der teurere Fehler; Fehlstart einer Session; eine Stufen-Session, die mit laufender eigener Arbeit aufgehört hat ([Die wartende Sitzung](#nachtbetrieb), Ausnahme ist die Stufe `abdeckung`) — sie hinterlässt ihren Vermerk am Dokument ihrer Stufe. Ein Abbruch beendet nur diese Kette, der nächste Kandidat kommt dran.

**Budgets** stehen in `night.kette` der `workflow.config.json`, alle optional, mit diesen Startwerten:

```json
{
  "night": {
    "kette": {
      "label": "kit:night",
      "varianteBLabel": "kit:durchziehen",
      "planMin": 20,
      "reviewMin": 15,
      "paketeMin": 15,
      "abdeckungMin": 10,
      "umsetzungMin": 120,
      "kostenUsd": 50,
      "kostenUsdB": 150,
      "korrekturrunden": 2
    }
  }
}
```

`varianteBLabel` kennzeichnet einen Fachplan für die Umsetzungsstufe (Variante B); `umsetzungMin` ist ihr Zeitbudget, `kostenUsdB` ihr eigener Kostendeckel.

Die Minuten gelten je Stufe (Korrekturrunden zählen gegen ihre Stufe), `kostenUsd` je Kette über alle Sessions, `korrekturrunden` je Dokument. Die Kette fordert den Session-Strom immer an: Kosten und Kennzahlen stehen je Stufe im Ergebnisstand (`art: "kette"`, die Budgets im Lauf-Kopf); eine Session ohne Kennzahl zählt 0 und erhöht `kostenUnbekannt`. Fehlt der Block oder einzelne Felder darin, gelten die Startwerte — und das ist sichtbar: Vor der ersten Kette nennt eine Protokollzeile die betroffenen Felder mit ihrem Wert, und der Lauf-Kopf des Ergebnisstands trägt sie als `budgetAusDefault`.

**Der Bericht am Fachplan.** Bei jedem Ausgang hinterlässt die Kette einen Kommentar mit dem Anker `## Nachtbericht, Kette <stempel>`: der Ausgang mit Grund; die Stufen (Plan mit Dauer, Kosten, Korrekturrunden, Prüfer und Marker; Pakete mit Titeln; nicht zuordenbare Karten); **alle Entscheidungen der Nacht**, fortlaufend nummeriert — die Aufzählungspunkte aus `## Architektonische Entscheidungen` des Plans wörtlich und die `Entscheidung:`-Zeilen aus dem Kontext der Pakete; die abgelehnten Befunde aus dem Kommentar `## Einarbeitung, Runde 1`; die Abdeckung; Kennzahlen (Pakete erreicht, Dauer ab Kettenstart, Zahl der Entscheidungen und der Stopp-Fragen, Kosten von Budget, `kostenUnbekannt`); bei `angehalten` die offene Stopp-Frage; überholte Pläne. Er endet mit dem Satz `Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.` — und genau das ist das Morgen-Ritual: Bericht lesen, Plan und Pakete sichten, was gelten soll als Satz in den Fachplan schreiben, Pakete nach Ready ziehen.

**Wartende Berichte.** Nimmt der Tracker den Kommentar nicht an, liegt der Bericht als `.claude/night-bericht-<F>-<stempel>.md` in der Hauptkopie — kein Rest im Arbeitsbaum, wie `night-run-*` —, und das Feld `bericht` der Einheit nennt den Pfad. Beim nächsten Start jeder Betriebsart (nicht im Dry-Run) trägt der Runner wartende Berichte nach und löscht die Datei; bleibt der Tracker tot, bleibt sie liegen und der Lauf geht weiter.

**Der Rückweg nach `angehalten`.** Die Kette schreibt die eine Frage als Kommentar `## Kette angehalten` an den Fachplan und setzt dort `kit:klaeren`; Plan und bis dahin geschnittene Pakete bleiben als Entwurf stehen. Du antwortest **im Fachplan** — als Satz im Body, nicht als Kommentar —, nimmst `kit:klaeren` ab und setzt `kit:night` neu. Die nächste Kette beginnt **von vorn**: Der neue Plan ist der gültige; ältere Pläne zum selben Fachplan bekommen den Kommentar `Ueberholt durch Plan #M2` (kein Label, kein Move) und stehen im Bericht unter „Ueberholt". Jeden dieser Kommentare liest die Kette einmal zurück; findet sie ihn an der Karte nicht wieder, läuft sie weiter, führt den Plan aber nicht als überholt, sondern mit Grund unter „Ueberholt, nicht bestaetigt" — ein Bericht, der eine Handlung behauptet, die am Board niemand sieht, ist schlimmer als keiner. `kit:klaeren` nimmt ausschließlich der Mensch ab — ein Lauf, der sein eigenes `kit:klaeren` abräumen dürfte, könnte sich selbst freigeben.

**Kette und Umsetzung nebeneinander.** Die beiden Betriebsarten meinen verschiedene Karten und Spalten: `kit:night` am Fachplan im Backlog, `kit:nightrun` am Arbeitspaket in Ready. Ein Lauf ist immer genau eine Betriebsart (`--kette` oder nicht), aber zwei Läufe dürfen zur selben Zeit fahren — die Kette im Worktree, die Umsetzung in der Hauptkopie. Eine Einschränkung gilt unter **Variante B**: Ihre Stufe `umsetzung` baut wie die Umsetzungsnacht in der Hauptkopie, nicht im Worktree, und beide nehmen dafür denselben Lock `.claude/night-umsetzung.lock` — wer ihn zuerst hält, baut; der andere Lauf lässt seine Umsetzung aus (die Kette fällt dabei auf Variante A zurück, die übrigen Stufen bleiben unberührt). Unter Variante A gilt die Einschränkung nicht: Die Kette baut nie, und der Lock bleibt frei.

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

**Morgen-Ritual:** Protokoll lesen (`.claude/night-run-<datum>.log`: Issue, Dauer, Ergebnis, Commit pro Runde) — derselbe Stand liegt zusätzlich auswertbar als `.claude/night-run-<datum>-<uhrzeit>.json` daneben —, dann wie immer `/review` → eigener Test → `push main`. Zurückgestellte Issues stehen kommentiert im Backlog.

## Aufwand des Prozesses

Jeder Ergebnisstand einer Nacht-Session (`.claude/night-run-<datum>-<uhrzeit>.json`) trägt seit Issue #748/#749 bereits Dauer, Kosten, Menge, Modell und Prüfstand. `node .claude/kit/aufwand.mjs auswerten` liest die jüngsten davon, aggregiert Zeit, Prüfungen, Umfang und Kosten und schreibt daraus `.claude/aufwand.md` (für Menschen) sowie `.claude/aufwand.json` (für die beiden Ausgabestellen unten). Das Werkzeug sagt nur, was auffällt — nie, was zu tun ist, und es schweigt, wenn nichts auffällt.

**Wo der Befund erscheint.** An genau zwei Stellen, und beide zusammen: als Abschlussblock im Laufprotokoll `.claude/night-run-<datum>.log`, den jeder unbeaufsichtigte Lauf am Ende selbst schreibt, und im Skill `/push-main`, der `node .claude/kit/aufwand.mjs befund` vor dem ersten Schritt ausführt und die Ausgabe zeigt. Beide sind nötig: Läuft der Nachtbetrieb künftig ohne Zutun eines Menschen an, liest den Laufbericht womöglich niemand mehr; das Veröffentlichen bleibt dagegen ein Schritt, den ein Mensch selbst auslöst.

**Kein Gate.** Der Befund hält weder einen Lauf noch `/push-main` auf. Ein Fehlschlag der Auswertung ist eine Protokollzeile, kein Abbruch.

**Laufzahl und Schwellen ändern.** Beides steht im optionalen Block `aufwand` der `.claude/workflow.config.json` (siehe [Alle Einstellungen](#alle-einstellungen)) — fehlt der Block oder ein Feld darin, gelten die eingebauten Vorgaben, ein bestehendes Projekt bekommt die Auswertung also ohne weitere Einrichtung. `aufwand.laeufe` bestimmt, wie viele der jüngsten Ergebnisstände einbezogen werden; `aufwand.schwellen` trägt die vier Grenzwerte (`pruefungAnteil`, `eingrenzungOhneWirkung`, `werkzeugAnteil`, `schreibkostenAnteil`), ab denen ein Befund erscheint. In der Einstellungs-Oberfläche steht der Block unter dem Thema „Nachtbetrieb".

## Verbrauch interaktiver Sitzungen

Der Nachtlauf meldet seinen Verbrauch selbst (siehe oben). Für die Sitzungen, in denen du selbst am Rechner sitzt, tut das der **Sitzungs-Melder**: `board.mjs sitzung melden` liest das Sitzungsprotokoll von Claude Code, summiert Eingabe-, Ausgabe- und Zwischenspeicher-Token und liefert sie über dieselbe Route ein wie der Runner — `POST /api/kanban/night-runs`, nur mit `kind`/`mode` **INTERACTIVE** und dem Startzeitpunkt der Sitzung als Schlüssel. Den Pfad des Protokolls nimmt er aus `--protokoll` oder als `transcript_path` aus dem Rumpf, den ein Claude-Code-Hook auf stdin hereinreicht.

**Wer ihn ruft.** Niemand von Hand. Bei projektlokaler Installation trägt der Installer zwei Einträge in den `hooks`-Block von `.claude/settings.json` ein, und Claude Code ruft den Melder von selbst:

| Ereignis | Aufruf | Wirkung |
|---|---|---|
| `Stop` | `node .claude/kit/board.mjs sitzung melden` | fortschreibend, `complete: false`, gedrosselt auf eine Meldung je fünf Minuten |
| `SessionEnd` | `node .claude/kit/board.mjs sitzung melden --complete` | abschließend, `complete: true` — danach ist die Wegmarken-Datei leer |

Die Einträge stehen in der **Projekt**-Datei und nicht in den Nutzer-Einstellungen unter `~/.claude`: Das Zielprojekt kommt aus der Bindung des Tokens im Arbeitsverzeichnis, und eine nutzerweite Einstellung meldete aus jedem Verzeichnis — auch aus jedem fremden.

Der Installer **ergänzt** die Datei, er ersetzt sie nicht: `env`, `sandbox`, `permissions` und fremde Hook-Einträge bleiben stehen, und ein zweiter Lauf ändert nichts mehr. Ist `settings.json` kein lesbares JSON-Objekt, fasst er sie nicht an und nennt die beiden Einträge zum Nachtragen von Hand — was er nicht lesen kann, kann er auch nicht erhalten.

**Bleibt der Melder stumm,** obwohl Token und Tracker stimmen, lohnt ein Blick auf die Sandbox: Läuft sie im Projekt, braucht der Aufruf eine Netz-Freigabe — `node .claude/kit/board.mjs*` in `sandbox.network.excludedCommands` derselben Datei. Ohne sie kommt der Melder bis zur Einlieferung und scheitert dort mit `nicht-eingeliefert`; die Sitzung stört das nicht, nur der Verbrauch fehlt.

**Abschalten.** Den jeweiligen Eintrag aus dem `hooks`-Block in `.claude/settings.json` löschen: beide für ganz, nur den unter `Stop` für „nur am Sitzungsende". Die Datei ist nicht versioniert, die Entscheidung gilt also für deine Maschine. Ein späterer Installer-Lauf trägt den gelöschten Eintrag wieder ein — wer den Melder dauerhaft stillstellen will, nimmt ihm die Voraussetzung statt den Hook: Ohne projektgebundenes Token im Arbeitsverzeichnis und bei jedem `issueTracker` außer `toolbox` schweigt er von selbst und sagt das auch (`kein-token`, `kein-board`).

**Die bekannte Lücke: Worktrees.** Eine interaktive Sitzung in einem `git worktree` meldet **nicht**. Ein frisch angelegter Worktree trägt nur die versionierten Dateien, und `.claude/*` ist per `.gitignore` ausgeschlossen: Dort fehlen `settings.json` — also der Hook — und `.claude/kit/` — also der Melder. Für die Worktrees der Nacht-Kette ist das folgenlos, denn dort ist `KIT_AGENT_MODEL` gesetzt und der Melder schwiege ohnehin; der Runner meldet diese Sitzungen selbst. Wer dagegen von Hand einen Worktree anlegt und darin arbeitet, findet diesen Verbrauch im Leitstand nicht wieder. Abhilfe von Hand: `.claude/settings.json` und `.claude/kit/` aus dem Hauptarbeitsbaum hinüberkopieren.

**Zuordnung zu Karten.** `issue move` vermerkt jeden Zug nach *In progress* und *In review* mit Zeitstempel in `.claude/wegmarken.tsv`. Der Melder teilt die Sitzungssumme anhand dieser Zeitstempel auf die Karten auf. Was zwischen keinen zwei Wegmarken liegt, meldet er als Rest ohne Kartennummer — er steht in der Sitzungssumme, aber in keiner Karte. Dasselbe gilt für Zeiträume, in denen **zwei Karten gleichzeitig offen** waren: Laufen zwei Sitzungen im selben Verzeichnis, mischen sich ihre Wegmarken in einer Datei, und eine Zuordnung wäre geraten. Sie unterbleibt.

**Wann gemeldet wird.** Am Sitzungsende mit `complete: true` — danach ist die Wegmarken-Datei leer. Dazwischen fortschreibend mit `complete: false`, gedrosselt auf höchstens eine Meldung je fünf Minuten: Nur am Ende zu melden verlöre jede abgestürzte Sitzung, ungedrosselt erzeugte jeder Zug einen HTTP-Aufruf.

**Wann nicht gemeldet wird.** Bei gesetztem `KIT_AGENT_MODEL` schweigt der Melder vollständig — diese Sitzung hat der Nacht-Runner gestartet und meldet sie bereits selbst; ein zweiter Weg zählte sie doppelt. Ohne projektgebundenes Zugriffstoken im Arbeitsverzeichnis meldet er ebenfalls nichts; das Zielprojekt kommt aus der Bindung des Tokens und nicht aus dem Aufruf. Beides endet ohne Fehler: Der Melder ist Buchhaltung, keine Bedingung, und darf eine Sitzung nie stören. Aus demselben Grund bleibt eine gescheiterte Einlieferung folgenlos — die Wegmarken bleiben stehen, der nächste Versuch sieht denselben Abschnitt noch.

**Die Preistabelle will gepflegt werden.** Das Sitzungsprotokoll führt keinen Dollarbetrag, nur Tokenmengen. Der Betrag wird deshalb gerechnet, mit den Sätzen aus **`kit/preise.mjs`** (im installierten Projekt: `.claude/kit/preise.mjs`). Die Datei trägt im Kopf das Datum ihres Standes und die Quelle, aus der die Zahlen stammen. **Sie veraltet von allein:** Ein neues Modell fehlt darin, und dann meldet der Melder für die betroffene Summe **keinen** Betrag — nie eine 0 und nie einen geschätzten. Die Tokenmengen stehen trotzdem da. Wer im Leitstand einen fehlenden Betrag sieht, trägt das Modell in `MODELL_STUFEN` nach und setzt `PREISE_STAND` neu; die Stufen selbst ändern sich nur, wenn Anthropic die Preise ändert. Fehlt die Datei ganz — etwa neben einer einzeln kopierten `board.mjs` —, läuft der Melder weiter, eben ohne Betrag.

## Leitplanken statt Prompts

Ein Sprachmodell reproduziert das häufigste Muster seines Trainingskorpus, nicht das aktuellste. Eine vor Monaten abgekündigte API steht in Millionen Zeilen Altcode noch als der normale Weg; der Abkündigungshinweis ist ein Randfall gegen diese Masse. Das Ergebnis ist ein Denkfehler, vielfach materialisiert: dasselbe veraltete oder abgekündigte Idiom, über alle Aufrufstellen ausgerollt — und oft erst spät in einer externen Analyse sichtbar.

Für solche wiederkehrenden, klassenweiten Fehler gilt dasselbe Prinzip wie beim Coverage-Gate: eine **harte Leitplanke, die im Pflicht-Gate scheitert**, statt ein Prompt oder eine Doku, die bittet. Ein Prompt an die Disziplin wird unter Zeitdruck übersprungen; eine Lint- oder Compiler-Regel in den `buildChecks`, die Agent und CI ohnehin durchlaufen, kann gar nicht erst grün committen. Konkret:

- **Die Leitplanke leitet aus vorhandenen Annotationen ab**, statt eine handgepflegte Verbotsliste zu führen, die selbst veraltet: `@typescript-eslint/no-deprecated` liest JSDoc-`@deprecated`, Java meldet mit `-Xlint:deprecation` und `-Werror` jede abgekündigte API als Build-Fehler, Linter-`recommended`-Sets decken die gängigen veralteten Idiome ab. Der Analyzer skaliert mit dem Ökosystem, die Liste nur mit der Pflegedisziplin.
- **Das Gate ist der Hauptfang, SonarQube o. Ä. das Sicherheitsnetz.** Der Round-Trip über main fängt sicher, aber spät — der Fehler ist dann schon auf main. Der Check gehört nach vorn, in `/local-check` und `/implement-ready`, wo der Agent ihn vor Abschluss läuft.
- **Der konkrete Regel-Katalog lebt im jeweiligen Projekt** (`buildChecks` in der Config, Lint-Setup im Repo), nicht im Kit. Das Kit verankert nur das übertragbare Prinzip.

**Der Grenzfall: wenn keine Leitplanke zu haben ist.** Manches lässt sich nicht messen — ob ein Modell eine Aussage geglaubt hat, statt sie nachzuschlagen, etwa. Dort tritt die ausgewiesene Selbstauskunft an die Stelle des Gates: Die feste Antwortform „Mitteilung übernommen, ungeprüft — …" aus [Mitteilungen: glauben statt nachsehen](#mitteilungen-glauben-statt-nachsehen) zwingt nichts, macht aber jeden Verstoß zum sichtbaren Widerspruch. Sichtbarer Widerspruch statt Gate — dasselbe Prinzip, nur mit dem schwächeren Mittel, weil das stärkere hier nicht existiert.

## Issue-Review über mehrere Modelle

Ein Dokument ist die Quelle der Wahrheit für den nächsten Schritt. Ein Fehler darin pflanzt sich fort, und der Autor sieht ihn nicht, weil er den Kontext im Kopf hat, aus dem das Dokument entstanden ist. `/issue-review` lässt Modelle lesen, die es **nicht** geschrieben haben: Sie liefern Befunde, und die Session, die den Skill aufgerufen hat, arbeitet sie ein oder lehnt sie mit einem Satz ab. Befunde sind Zuarbeit, kein Gate — ob eine Stufe fertig ist, sagt ein Kommando oder ein Mensch, nie ein Modell-Marker.

### Drei Prüfstufen — die Prüfung wandert nach oben

Welche Stufe greift, entscheidet das Titel-Präfix, und jede Stufe hinterlässt ihre eigene Spur:

| Stufe | Prüft | Nachweis |
|---|---|---|
| `fachlich` | ein `[Fachlich]`-Issue — die fachliche Anforderung aus [/fachplan](#fachplan) | `Fachplan-Review: …` |
| `plan` | ein `[Plan]`-Issue — das Plandokument aus [/techplan](#plan) | `Plan-Review: …` |
| `issue` | ein technisches Arbeitspaket aus [/issues](#issues) | `Issue-Review: …` |
| `issue` | ein `[Task]`-Arbeitspaket aus [/task](#task) — `[Task]` ist **kein Dokument-Präfix** | `Issue-Review: …` |

**Wo der Nachweis steht:** beim Arbeitspaket im Abschnitt `## Kontext`, bei der fachlichen Anforderung im Abschnitt `## Ziel` neben `Autor-Modell:`, beim Plandokument vor `## Ziel` neben `Plan-Modell:`. Der Marker ist eine Spur, keine Freigabe: Kein Skill liest ihn als Bedingung für den nächsten Schritt.

**Der Aufruf ist immer derselbe: `/issue-review #N`.** Es gibt bewusst kein eigenes Kommando je Stufe — welche greift, liest der Skill am Titel-Präfix ab. Das gilt interaktiv genauso wie im Nachtbetrieb; der Unterschied liegt nur darin, ob vor dem Schreiben gefragt wird. Ohne Nummer nimmt der Skill alle `[Fachlich]`- und `[Plan]`-Dokumente aus dem Backlog, die noch keinen Marker ihrer Stufe tragen. Arbeitspakete prüft er nur mit expliziter Nummer: Der Regelfall ist Ready ohne Paket-Review, was ein Paket falsch macht, fangen die Build-Gates und der Code-Review. `[Idee]` ist immer ausgeschlossen.

**Warum nach oben.** Die Reichweite eines Fehlers wächst nach unten: Ein Fehler in der fachlichen Anforderung pflanzt sich in den Plan fort, von dort in jedes Arbeitspaket und in allen Code. Früher gefundene Fehler sind billiger zu beheben und verhindern am meisten.

**Warum das Arbeitspaket keinen eigenen Prüfer mehr braucht.** Scope, Abhängigkeiten und Kollateralschäden im Bestand entscheiden sich im Plan, nicht im einzelnen Paket; die frühere Scope-Rolle ist deshalb als `schnitt-abhaengigkeiten` auf die Plan-Stufe gewandert, wo sie den ganzen Zuschnitt vor sich hat.

**Form vor Inhalt.** Der Maßstab jeder Stufe ist ihr Format: die vier Story-Abschnitte, die sechs Plan-Überschriften, die vier Abschnitte des Arbeitspakets. Die Form prüft kein Modell, sondern `issue check-form` (siehe [Board-Adapter](#board-adapter)); Verstöße behebt die Session, bevor ein Reviewer startet. Das Plandokument trägt genau diese Überschriften in dieser Reihenfolge:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

### Ablauf

Vorflug mit `issue-review check`, dann `issue check-form <id>`, dann `issue-review roles --stufe <stufe> --author <modell>` für Rollen und Besetzung. Jeder Reviewer bekommt denselben Body und seine Rolle: `form-beobachtbarkeit` und `abgrenzung` für die fachliche Anforderung, `architektur-bestand` (der Senior, der den Bestand kennt) für den Plan, `pruefbarkeit` für das Arbeitspaket; jede Rolle trägt die Streich-Frage „Was kann raus?". Der Plan-Reviewer bekommt zusätzlich den Body der in `Fachliche Quelle:` genannten Karte — vom Board, nie aus dem Gespräch — und den Pfad einer `Vorlage:`-Zeile; er prüft damit auch, ob der Plan jedes Ziel, jedes Akzeptanzkriterium und jede beantwortete Frage der Quelle herstellt. Ohne Quelle entfällt dieser Eingang. Die Befunde gehen als Kommentar `## <Stufe>-Review, Runde 1` ans Dokument. Danach arbeitet die aufrufende Session jeden Fund ein oder lehnt ihn mit einem Satz ab, nach der Regel „Entscheiden statt fragen" aus `CLAUDE-workflow.md`: interaktiv nach einem Wort der Zustimmung, unbeaufsichtigt direkt; nur ein Fund der Stopp-Klasse hält an und zeichnet das Dokument mit `kit:klaeren`. Der neue Body geht über `issue update`, dazu die Marker-Zeile der Stufe — unbeaufsichtigt mit dem Zusatz `, Nachtlauf` — und ein Kommentar `## Einarbeitung, Runde 1` mit der Liste übernommen / abgelehnt und Grund. Eine Runde, keine zweite: Weitere Runden finden erfahrungsgemäß Geschmacksfragen.

### Konfiguration

Der Installer legt `.claude/workflow.config.example.json` neben die echte Config; daraus den `issueReview`-Block übernehmen. **Der Installer schreibt ihn nicht selbst** — `reviewers` hängt davon ab, welche CLIs auf der Maschine liegen, und `pairs` ist eine Entscheidung. Ein Reviewer ist ein Adapter: `kind: claude` läuft als Subagent mit dem konfigurierten `model`, `kind: command` als beliebiges CLI mit dem Prompt über stdin und der Antwort auf stdout — Codex, Gemini, ein eigenes Skript. Wer wen prüft, steht in `pairs`; sonst greift die Regel „die vordersten Reviewer, die nicht der Autor sind". Die Zuordnung zeigt `issue-review matrix`.

```json
"reviewStufen": {
  "fachlich": { "reviewer": 2, "rollen": ["form-beobachtbarkeit", "abgrenzung"] },
  "plan":     { "reviewer": 1, "rollen": ["architektur-bestand"] },
  "issue":    { "reviewer": 1, "rollen": ["pruefbarkeit"] }
}
```

Bestehende Installationen **ohne** `reviewStufen`-Block behalten die alte Besetzung mit zwei Reviewern je Stufe; erst ein ausdrücklich geschriebener Block aktiviert die Stufen-Besetzung. Ein Kit-Update ändert das Prüfverfahren also nicht im Vorbeigehen.

## Spec-Driven Development

Ein Projekt kann unter `specs/` eine Spezifikation seines fachlichen Soll-Verhaltens führen. Wer plant, liest sie statt Produktionscode — und bekommt ausdrücklich gesagt, wo sie schweigt. Wer ein Arbeitspaket schneidet, sagt, was es an ihr ändert. Wer pusht, sieht vorher den Diff und wird aufgehalten, wenn Paket und Beschreibung nicht zusammenpassen.

**Ein Projekt ohne diesen Block merkt davon nichts.** Keine zusätzliche Frage im Ablauf, keine Warnung, kein verändertes Verhalten in irgendeinem Skill — ohne den `spec`-Block bleibt alles unverändert.

### Der Schalter

Eingeschaltet wird über den Block `spec` in `.claude/workflow.config.json`. **Das Vorhandensein des Blocks ist der Schalter** — es gibt bewusst kein Feld `enabled`. Ein Bool hätte einen Aus-Zustand, und den soll es nicht geben.

```json
"spec": {
  "seit": "2026-09-03",
  "bereiche": {
    "board": ["kit/board.mjs"],
    "installer": ["install.mjs", "tools/sync-blobs.mjs"]
  },
  "testGlobs": ["test/*.test.mjs"],
  "testPattern": "\\[<ID>\\]"
}
```

`seit` ist der Zeitpunkt: Nur Pakete mit einem Anlagedatum ab diesem Tag wertet das Gate. Alles davor bleibt unberührt — es wird nichts nachgetragen.

`bereiche` bildet Bereichsnamen auf Code-Globs ab. **Diesen Schnitt macht ein Mensch.** Kein Werkzeug schlägt ihn vor: Die Bereiche aus dem vorhandenen Code abzuleiten hieße, das Soll aus dem Ist zu rechnen — genau das, was dieses Verfahren vermeiden soll.

`testPattern` und `testGlobs` sagen, wo das Gate den Verweis auf eine Aussage sucht (Standard: `\[<ID>\]`).

Der Installer fragt danach — projektlokal, und nur wenn noch kein Block da ist. Ist er vorhanden, entfällt die Frage: Ein „Nein" dürfte ihn sonst entfernen.

### Es gibt keinen Weg zurück

Die Entscheidung ist nicht zurückzunehmen, und der Installer sagt das vor der Antwort. Ehrlich dazu gehört, was das heißt: **Das Kit bietet keinen Weg zurück an** — es gibt kein Kommando, keine Frage, keine Option dafür. Ein Mensch kann den Block natürlich von Hand aus der Config löschen; niemand hindert ihn daran. Zugesichert ist nur, dass das Werkzeug es nicht anbietet, und mehr wäre auch nicht ehrlich zuzusichern.

### Nicht auf jedem Tracker

Spec-Driven Development setzt auf einem Board mit Aktivitätsverlauf auf: Das Anlagedatum eines Pakets, an dem `seit` hängt, kommt von dort. **Bei `issueTracker: github` und `gitlab` weist `spec.mjs` deshalb jeden Lauf ab** — dort gibt es weder Verlauf noch Suche über Aussagen. Möglich sind `toolbox` und `local`. Die Einschränkung fällt sofort auf und nicht erst beim ersten Push: Der Installer stellt die Frage bei diesen Trackern gar nicht.

### Wie die Beschreibung aussieht

Eine Datei je Bereich, benannt nach ihm:

```
specs/
  INDEX.md              eine Zeile je Bereich, erzeugt von `spec.mjs index`
  board.md              die Aussagen des Bereichs `board`
  vorhaben/VER.md       je Vorhaben: wurde Produktionscode gelesen?
```

Die Vorhaben-Notiz nimmt einen Umweg: Beim Planen entsteht sie als **wartende** Datei `.claude/vorhaben-wartend-VER.md`, und erst der nächste Push hebt sie nach `specs/vorhaben/` auf. Der Grund ist der Zeitpunkt — geplant wird mitten in einer Session, oft unbeaufsichtigt, und eine ungefragte Änderung unter `specs/` wäre dort ein unsauberer Working Tree.

Eine Aussage ist eine Zeile mit ID und Text. Gestrichene Aussagen wandern unter `## Entfallen` ans Dateiende — mit Datum und der Nummer des Pakets, das sie gestrichen hat:

```markdown
- board-1 — issue activity gibt den Aktivitätsverlauf einer Karte aus.
- board-2 — issue get liefert die Labels als Namen-Array.

## Entfallen

- board-3 — Der Adapter liest das Anlagedatum aus der Karte. (entfallen 2026-09-02, Paket #460)
```

**Gestrichene Aussagen bleiben unter `## Entfallen` stehen, und ihre Nummern werden nie wieder vergeben.** Der Grund ist die Rückverfolgbarkeit: Ein Test, ein Commit oder ein altes Paket kann Jahre später auf `board-3` verweisen. Würde die Nummer neu vergeben, zeigte der Verweis auf etwas anderes — eine stillschweigende Umdeutung, die niemand bemerkt. So zeigt er auf das ausdrücklich Gestrichene, samt Datum und Anlass.

### Was ein Arbeitspaket sagt

Bei eingeschaltetem Projekt trägt jedes Arbeitspaket einen fünften Abschnitt `## Spec-Wirkung`, zwischen `## Akzeptanzkriterium` und `## Abhängigkeiten`. Die Pflicht gilt für Arbeitspakete — ein Titel mit `[Fachlich]`, `[Plan]` oder `[Idee]` wird auch ohne den Abschnitt angelegt, weil aus ihm nie ein Commit entsteht. Wer ihn dort freiwillig schreibt, wird an derselben Grammatik gemessen. Er besteht ausschließlich aus Zeilen dieser vier Formen:

```
NEU       <BEREICH> <ID> — <Aussage>
GEAENDERT <ID> — <neuer Aussage-Text>
ENTFAELLT <ID> — <Grund>
KEINE     — <Begruendung>
```

Vor dem Freitext steht der Gedankenstrich `—`, nicht der Bindestrich. `KEINE` steht allein und braucht eine Begründung: „keine Wirkung" ist eine Aussage, kein Weglassen.

Der Adapter lehnt ein Paket ohne diesen Abschnitt ab — nicht als Bitte im Skill-Text, sondern beim Anlegen. Eine Bitte ist die Leitplanke, die unter Druck übersprungen wird.

### Das Gate beim Push

`/push-main` bekommt bei eingeschaltetem Projekt einen zusätzlichen Schritt, und seine Lage ist nicht beliebig:

1. **Vorschau, vier Teile.** `spec.mjs apply --dry-run` zeigt, was sich an der Beschreibung ändern würde; `spec.mjs vorhaben-sichern --dry-run`, welche wartenden Vorhaben-Notizen aufgehoben würden. Dazu zwei Blicke mit `git`: was unter `specs/vorhaben/` schon liegt, und was unter `specs/` schon gestaged war. Beide sind nötig, weil die `apply`-Vorschau gegen den Stand auf der Platte rechnet und einen Rest aus einem früheren roten Lauf nicht als Änderung meldet.
2. **Zustimmung.** Ohne sie wird nicht gepusht. Sie deckt alles Gezeigte ab; eine zweite Rückfrage gibt es nicht.
3. **`apply`, Aufheben und Commit** — **vor** den Pflicht-Checks. `apply` schreibt Dateien, die in denselben Push gehen; liefen die Checks vorher, prüften sie einen Stand, der nicht der gepushte ist. In den Commit gehen genau drei Mengen: `specs/vorhaben/`, die Dateien aus diesem `apply`-Lauf und was unter `specs/` schon gestaged war — alles andere bleibt liegen, damit der Commit keine handgeführte Änderung einsammelt, die niemand angefordert hat.
4. **Pflicht-Checks, dann `check`** auf dem Batch, wie er gepusht wird. Ein Befund hält den Push auf.

Ein Fehlschlag beim Aufheben hält den Ablauf **nicht** auf: Die Notiz bleibt an ihrem wartenden Ort, wird benannt, und der nächste Push holt es nach. Der Commit-Betreff trägt dabei nie ein Suffix mit einer Paketnummer — daran und nur daran erkennt das Werkzeug ein Arbeitspaket, und dieser Commit ist keines.

Geprüft wird zweierlei: dass jede Wirkungsangabe in der Beschreibung angekommen ist, und dass jede neue oder geänderte Aussage von mindestens einem Test referenziert wird. **Gewertet werden nur Pakete ab `seit`** — der Bestand bleibt außen vor.

### Die Kommandos

| Kommando | Was es tut |
|---|---|
| `node .claude/kit/spec.mjs index` | Schreibt `specs/INDEX.md` neu: je Bereich die Zahl der gültigen und der entfallenen Aussagen. |
| `node .claude/kit/spec.mjs show` | Gibt die Aussage zu einer ID aus, mit Bereich und Status. |
| `node .claude/kit/spec.mjs check` | Prüft die Spec-Wirkung — `--paket` die Form einer Paketdatei, `--anker` als Gate den ganzen Batch. |
| `node .claude/kit/spec.mjs luecken` | Meldet je Bereich, wozu die Beschreibung schweigt — auch wenn die Liste leer ist. |
| `node .claude/kit/spec.mjs vorhaben` | Legt die Notiz an, ob für ein Vorhaben Produktionscode gelesen wurde. |
| `node .claude/kit/spec.mjs vorhaben-sichern` | Hebt die wartenden Vorhaben-Notizen nach `specs/vorhaben/` auf — immer mit einer JSON-Antwort, auch wenn keine wartet. |
| `node .claude/kit/spec.mjs apply` | Schreibt die Beschreibung aus den Wirkungsangaben fort. |

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
| `reviewCommand` | die Alternative zu `reviewModel`: wer mit fremder CLI reviewt, hat sie lokal installiert |
| `reviewScope` | manche lesen lieber den vollen Quelltext |
| `triggers` | Tippgewohnheit für die drei Stop-Phrasen |
| `toolbox.tokenFile` | zeigt auf ein Token im eigenen Dateisystem |

Alles andere wird ignoriert und auf stderr gemeldet.

**Das Reviewer-Paar weicht als Paar.** `reviewModel` und `reviewCommand` sind eine Oder-Entscheidung — genau eines gilt. Setzt die persönliche Datei eines der beiden, verschwindet das andere aus dem Ergebnis, auch wenn es aus der geteilten Config kommt. Ohne diese Ausnahme vom feldweisen Mischen hätte der Normalfall — das Team fährt den Claude-Default, einer reviewt mit `codex` — eine Config mit beiden Feldern und verletzte die Regel, die das Schema durchsetzt.

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

- **Issue-Tracker-Interface:** `issue create`, `issue list`, `issue get`, `issue activity`, `issue move`, `issue comment`, `issue epics`
- **Code-Host-Interface:** `code repo-name`, `code pr`

**`issue list` liefert Arbeitspakete, `issue epics` liefert Vorhaben.** Die Trennung ist scharf: Vorhaben erscheinen in `issue list` nie, auch nicht ohne Status-Filter. Sie sind Klammern über mehreren Karten, keine Arbeit — wer sie in einer Liste offener Issues mitzählt, hält sie für Arbeitspakete mit dünner Beschreibung. `issue epics` liefert sie mit Kürzel und Fortschritt (`#360 [HER] … 8/8`), also mit der Information, die ein Vorhaben tatsächlich trägt.

**Ein Vorhaben hat keinen Status.** `issue get` liefert darauf `status: null`, nicht `backlog`. Der Grund liegt im Server: Er lässt ein Vorhaben per `move` gar nicht auf dem Board positionieren („Epics werden nicht auf dem Board positioniert"). Ein Status, den kein `move` je ändern kann, wäre eine Behauptung über etwas, das es nicht gibt; `null` heißt „hat keinen".

Vorhaben kennen nur die Tracker **local** und **toolbox**. Bei **github** und **gitlab** weist `issue epics` mit einer Meldung ab, die beide fähigen Tracker nennt — dort ist der Fehlschlag der Normalfall, und Aufrufer wie `/kontext` überspringen ihn still.

**Formprüfung: `issue check-form`.** Die maschinellen Gates aus den Registern `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md` prüft ein Kommando, kein Modell: `node .claude/kit/board.mjs issue check-form <id>` gegen eine Karte, oder `issue check-form --body-file <pfad> --title "<titel>"` gegen eine Datei, bevor sie angelegt wird. Die Stufe kommt aus dem Titel-Präfix. Geprüft werden bei `[Fachlich]` F1, F2, F6, F7, F9 und F11, bei `[Plan]` P1, P2, P3, P6 und P12, beim Arbeitspaket (mit oder ohne `[Task]`) I1 bis I5: die vier Abschnitte in Reihenfolge mit `## Abhängigkeiten` zuletzt, `Autor-Modell:` im Kontext, Abhängigkeiten als `Keine.` oder `#N`, keine Herkunftszeile im Abhängigkeiten-Abschnitt, und bei einer Zeile `Vorlage: <Pfad> — verbindlich` im Kontext eine Abnahme per Bildschirmfoto im Akzeptanzkriterium. Gelesen wird ohne Codeblöcke und mit Umlauten in beiden Schreibweisen. Die Ausgabe ist immer JSON mit `ok`, `stufe` und `verstoesse`; bei Verstößen endet das Kommando mit Exit 1, ein abgewiesener Aufruf trägt `fehler`. Die `[Urteil]`-Gates bleiben Sache des Reviewers, und ans Board schreibt das Kommando nie.

**Vorlagen durch die Kette.** Bringt der Mensch einen Gestaltungsentwurf, ein Mockup oder eine Skizze mit, führen `/fachplan`, `/techplan` und `/issues` ihn als Zeile `Vorlage: <Pfad> — verbindlich | Anregung` weiter: im Ziel des Fachplans, im Kopf des Plans, im Kontext jedes Pakets, das eine Ansicht berührt. „Verbindlich“ heißt: Der Plan entscheidet keine Gestaltungsfrage gegen die Vorlage, jedes betroffene Paket nennt die Stelle der Vorlage und wird per Bildschirmfoto neben ihr abgenommen, und `/fachplan` fragt, ob die Designquelle des Projekts zuerst umgestellt werden soll. Ohne diese Spur verdunstet eine Vorlage zwischen den Stufen — alle Checks grün, und die Ansicht sieht aus wie vorher.

Die Skills rufen ausschließlich den Adapter auf — sie wissen nichts von `gh` oder `glab`. Du kannst `issueTracker` und `codeHost` jederzeit in der Config ändern; alle Skills passen sich beim nächsten Aufruf an.

**Abarbeitungsreihenfolge = Board-Reihenfolge.** `issue list --status <spalte>` liefert die Issues in der Reihenfolge der Board-Spalte (oben zuerst), nicht numerisch — du steuerst die Abarbeitung von `/implement-ready` also per Drag&Drop in der Ready-Spalte. Umgesetzt pro Tracker: GitHub über die manuelle Projekt-Reihenfolge von `gh project item-list` (gilt für die Standard-Board-View; eine View mit eigener Sortierung zeigt anders an, als die API liefert), GitLab über `--order relative_position`, das eigene Kanban über die Spalten-Position der API. Zwei bewusste Ausnahmen: der lokale Datei-Tracker kennt keine Positionen und bleibt numerisch, und `issue list` ohne Status-Filter bleibt überall stabil numerisch (eine spaltenübergreifende Board-Reihenfolge gibt es nicht). Konsequenz: Die Abarbeitungsreihenfolge hängt am Board-Zustand und ist nicht mehr deterministisch-numerisch — das ist gewollt.

#### Herkunft am Board: `--derived-from`

`issue create` nimmt optional `--derived-from <nummer>` entgegen und schickt die **projektweite Kartennummer** des **nächsten Vorfahren** als Feld `derivedFrom` mit. Damit kennt das Board die Kette Fachplan → Plan → Arbeitspaket als Daten und muss sie nicht aus Beschreibungstexten zusammensuchen.

Gesetzt wird immer nur **ein** Verweis, der auf die nächsthöhere Stufe — der Rest ergibt sich durchs Weiterlaufen der Kette. Wer sie setzt:

| Skill | Verweis |
|---|---|
| `/fachplan` | **nie** — die fachliche Anforderung ist die Wurzel und hat keinen Vorfahren |
| `/task` | **nie** — ein `[Task]` hat keinen Vorfahren; er steht in gar keiner Kette, auch nicht als Wurzel |
| `/techplan` | auf das `[Fachlich]`-Issue, wenn der Plan aus `/techplan #N` entstand; beim Plan aus dem Chat gar keiner |
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

`/kontext` lädt die Vorhaben über den Board-Adapter und liest `projectDocs` aus dem Repo. Am Ende erscheint ein Hinweis: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."

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
