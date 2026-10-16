# Einstellungen

Das Kit liest seine Einstellungen aus `.claude/workflow.config.json`; die Datei gehört ins Repository und gilt für das ganze Team. Daneben trägt `.claude/workflow.config.local.json`, die nicht ins Repository gehört, persönliche Abweichungen, etwa ein anderes Review-Modell oder den Pfad zu einem Token; was nur teamweit gilt, ignoriert das Kit dort. Jede Einstellung heißt mit ihrem englischen Namen. Deutsche Namen liest das Kit weiter, schreibt sie nie.

Die Einstellungen stehen unten in vier Teilen: Beim Einrichten nötig, Lohnt sich, Vom Kit verwaltet (veraltet, vom Installer gesetzt oder intern) und Feinabstimmung mit guten Vorgaben. Fehlt eine Einstellung in der Datei, gilt ihre Vorgabe. Jede steht mit demselben Satz auch in `.claude/workflow.config.example.jsonc`; diese Datei liest das Kit nie.

Pflegen lassen sich die Einstellungen auch über eine lokale Oberfläche, die einzelne Datei [settings.mjs](https://docs.mwolff.org/settings.mjs), für alle Projekte unter einem Ordner:

```bash
node settings.mjs ~/ki-projects
```

Ihre Adresse trägt ein Zugangstoken und ist nur von diesem Rechner erreichbar. Die Oberfläche gliedert in die Teile Reviewer, Paarungen, Prüfstufen, Befunde, Prüfkommandos und Bereiche, Nacht-Kette, Aufwand, Wirksamkeit, Aufgabenstufen und einfache Gruppen. Zu jeder Einstellung, die persönlich abweichen darf, zeigt sie Team-Wert, Abweichung und geltenden Wert; ungültige Werte weist sie vor dem Speichern mit Grund zurück.

## Alle Einstellungen

<!-- einstellungen:start -->
_Dieser Abschnitt entsteht aus `templates/workflow.config.schema.json` mit `node tools/config-referenz.mjs`; Änderungen gehören ins Schema, nicht hierher._

### Beim Einrichten nötig

- `language` — Sprache des Kits in diesem Projekt: de (Deutsch) oder en (Englisch). Gültig: `de`, `en`. Vorgabe: `de`. Stellt Texte, Board-Namen und Kommentare des Kits auf Englisch um; `en` setzen, wenn das Team englisch arbeitet.

- `codeHost` — Wo der Code liegt (Push, Pull Requests). Gültig: `github`, `gitlab`, `local`. Vorgabe: `github`. Legt fest, wohin gepusht wird und wo Pull Requests entstehen; beim Einrichten setzen, wenn der Code nicht auf GitHub liegt.

- `issueTracker` — Wo die Issues verwaltet werden. Gültig: `github`, `gitlab`, `local`, `toolbox`. Vorgabe: `github`. Legt fest, wo das Board liegt; beim Einrichten setzen, wenn die Issues nicht auf GitHub liegen, etwa `local` für Dateien im Repo.

- `buildChecks` — Die Prüfkommandos des Projekts (Build, Tests). Vorgabe: `[]`. Bestimmt, was vor jedem Commit und vor `push main` geprüft wird; beim Einrichten die Build- und Testkommandos des Projekts eintragen.
- `buildChecks[]` — Ein Prüfkommando, als Kommandostring oder als Objekt mit `cmd` und den Feldern darunter. Keine Vorgabe.
- `buildChecks[].cmd` — Die Kommandozeile, wie sie in der String-Form stünde. Keine Vorgabe.
- `buildChecks[].areas` — Bereichsnamen aus `checkAreas`; die Prüfung läuft, wenn einer davon berührt ist. Keine Vorgabe.
- `buildChecks[].always` — true = entschieden immer laufend, unabhängig von den berührten Bereichen. Keine Vorgabe.
- `buildChecks[].stage` — Wann die Prüfung an der Reihe ist: "paket" beim Abschluss eines Arbeitspakets, "push" vor dem Veröffentlichen, "merge" vor der Freigabe. Gültig: `paket`, `push`, `merge`. Vorgabe: `paket`.
- `buildChecks[].notAtCompletion` — Warum die Prüfung beim Abschluss eines einzelnen Pakets entfallen darf. Gültig: `zusammenspiel`, `volleTestmenge`. Vorgabe: nicht gesetzt, die Prüfung läuft auch beim Abschluss.
- `buildChecks[].completionAreas` — Bereiche, deren Berührung die Prüfung auch beim Abschluss laufen lässt. Vorgabe: nicht gesetzt, die Prüfung entfällt beim Abschluss.
- `buildChecks[].quality` — Benennt diese Prüfung als Gütemessung, deren Wert unter der Marke das Veröffentlichen anhält. Keine Vorgabe.
- `buildChecks[].quality.pattern` — Regulärer Ausdruck mit genau einer Gruppe; sie greift den gemessenen Prozentwert aus der Ausgabe des Kommandos. Keine Vorgabe.
- `buildChecks[].quality.marker` — Der Prozentwert, ab dem die Messung genügt. Werte: 0 bis 100. Keine Vorgabe.
- `buildChecks[].concurrent` — Ob diese Prüfung in "checks.mjs run" neben anderen laufen darf. Vorgabe: `false`.
- `buildChecks[].upfront` — Ob diese Prüfung in "checks.mjs run" vor allen anderen läuft. Vorgabe: `false`.
- `buildChecks[].kind` — Mit `hinweis` meldet die Prüfung nur und hält nie an. Gültig: `hinweis`. Vorgabe: eine gewöhnliche Prüfung, deren Rot den Lauf anhält.

- `mainBranch` — Branch für lokale Commits und Push (Schritt 7). Vorgabe: `main`. Der Zweig für lokale Commits und `push main`; nur setzen, wenn er nicht `main` heißt.

- `productionBranch` — Ziel-Branch für den PR in Schritt 8 (merge production). Vorgabe: `production`. Der Zweig, in den `merge production` den Pull Request stellt; nur setzen, wenn er nicht `production` heißt.

- `local` — Einstellungen für den lokalen Issue-Tracker (issueTracker: 'local'). Vorgabe: die Werte der Felder darunter. Der Ordner, in dem der lokale Tracker seine Issues ablegt; nur mit `issueTracker` `local` und einem anderen Ordner als `issues` setzen.
- `local.issuesDir` — Verzeichnis der Issue-Markdown-Dateien, relativ zum Projekt-Root. Vorgabe: `issues`.

- `github` — GitHub-spezifische Einstellungen. Keine Vorgabe. Das GitHub-Projekt, dessen Spalten das Board sind; beim Einrichten mit einem Board auf GitHub nötig, der Installer trägt es ein.
- `github.projectNumber` — Nummer des GitHub Project Boards (gh project list). Werte: ab 1. Keine Vorgabe.

- `toolbox` — Einstellungen für den Toolbox-Issue-Tracker (issueTracker: 'toolbox'). Keine Vorgabe. Der Zugang zum Toolbox-Tracker des Autors; nur mit `issueTracker` `toolbox` setzen.
- `toolbox.host` — Basis-URL der Toolbox-Instanz. Keine Vorgabe.
- `toolbox.tokenFile` — Pfad (relativ zum Projektverzeichnis) zu einer Datei mit dem projekt-/board-gebundenen Token. Keine Vorgabe.

- `issueReview` — Issue-Review über mehrere Modelle. Keine Vorgabe. Legt fest, welche Modelle Fachplan, Plan und Pakete prüfen; beim Einrichten setzen, denn ohne Reviewer hält die Nacht-Kette vor dem Start an.
- `issueReview.requiredBeforeReady` — Ist es true, stellt der Nacht-Runner Ready-Issues ohne Review-Marker kommentiert ins Backlog zurück. Vorgabe: `false`.
- `issueReview.reviewers` — Die Reviewer in der Reihenfolge, in der sie genommen werden; der Autor nie. Keine Vorgabe.
- `issueReview.reviewers[].name` — Kurzname, wird mit dem Autor-Modell des Issues verglichen. Keine Vorgabe.
- `issueReview.reviewers[].kind` — 'claude' läuft als Subagent über das Agent-Tool, 'command' als beliebiges fremdes CLI (Prompt über stdin). Gültig: `claude`, `command`. Keine Vorgabe.
- `issueReview.reviewers[].model` — Nur bei kind 'claude': Modell-Identifier. Keine Vorgabe.
- `issueReview.reviewers[].command` — Nur bei kind 'command': Kommandozeile, z.B. 'codex exec --model gpt-5'. Keine Vorgabe.
- `issueReview.reviewers[].readLimit` — Nur bei kind 'command': der Nur-Lese-Schalter des fremden Werkzeugs. Keine Vorgabe.
- `issueReview.pairs` — Explizite Zuordnung Autor -> Reviewer. Vorgabe: keine Zuordnung, es gilt die Reihenfolge in `reviewers`.

### Lohnt sich

- `checkAreas` — Benannte Bereiche des Projekts. Keine Vorgabe. Ordnet Pfade benannten Bereichen zu, damit eine Prüfung nur läuft, wenn ihr Bereich berührt ist; setzen, sobald der volle Prüflauf zu lange dauert.

- `noCheck` — Dateien, die keine Prüfung liest. Vorgabe: `[]`. Nimmt Dateien, die keine Prüfung liest, aus dem vollen Prüflauf heraus; setzen, wenn etwa eine reine Textänderung alle Prüfungen auslöst.
- `noCheck[].pattern` — Pfadmuster wie in checkAreas: "*" innerhalb eines Segments, "**" über Segmentgrenzen hinweg, "/" als Trenner. Keine Vorgabe.
- `noCheck[].reason` — Warum keine Prüfung den Inhalt dieser Datei liest. Keine Vorgabe.

- `coupledAreas` — Bereiche mit gemessener Kopplung. Vorgabe: `[]`. Vermerkt mit Grund, dass ein Bereich wegen einer gemessenen Kopplung fast alle Prüfungen auslöst; setzen, wenn die Auswertung einen solchen Bereich meldet und die Kopplung gewollt ist.
- `coupledAreas[].area` — Name des Bereichs, wie er in checkAreas steht. Keine Vorgabe.
- `coupledAreas[].reason` — Welche gemessene Kopplung den Bereich in fast alle Prüfkommandos zwingt. Keine Vorgabe.

- `testLocations` — Wo die eigenen Tests eines Bausteins liegen. Vorgabe: die Ablagen des Kits für TypeScript und Java. Sagt dem Kit, wo die Tests eines Bausteins liegen, damit ein Plan Hinweise auf betroffene Tests bekommt; setzen, wenn die Ablage nicht dem TypeScript- oder Java-Muster folgt.
- `testLocations[].source` — Muster der Quelldatei, etwa src/{pfad}/{name}.ts. Keine Vorgabe.
- `testLocations[].test` — Muster ihres eigenen Tests, mit denselben Platzhaltern und * innerhalb eines Segments, etwa src/{pfad}/{name}*.test.ts. Keine Vorgabe.
- `testLocations[].defaults` — Fügt die Vorgaben des Kits an dieser Stelle ein. Wert: `true`. Keine Vorgabe.

- `mutationCommand` — Kommando für Mutations-Tests (optional). Vorgabe: leer. Lässt vor jedem `push main` Mutationstests laufen, die nur berichten; setzen, wenn das Projekt ein Werkzeug wie PIT oder Stryker hat.

- `qualityCommands` — Weitere Kommandos bzw. Kommando-Präfixe, die eine Gütemessung starten (optional). Vorgabe: `[]`. Hält weitere Gütemessungen aus den Akzeptanzkriterien der Pakete heraus; setzen, wenn das Projekt eine teure Messung hat, die keine Prüfung ist.

- `formatFixCommand` — Kommando, das Formatierungsverstöße behebt. Vorgabe: leer. Behebt Formatverstöße selbst und prüft einmal neu, statt den Lauf rot enden zu lassen; setzen, wenn das Projekt einen Formatierer hat.

- `installCommand` — Kommando, das die Abhängigkeiten herstellt. Vorgabe: leer. Stellt in einem frischen Worktree die Abhängigkeiten her; setzen, wenn das Projekt Worktrees nutzt und Pakete installieren muss, etwa mit `npm ci`.

- `pushCheck` — Wo der volle Prüflauf vor 'push main' stattfindet. Gültig: `lokal`. Vorgabe: `lokal`. Verlegt den vollen Prüflauf vor `push main` in den Build-Dienst; setzen, wenn er lokal zu lange dauert oder die CI ohnehin dasselbe prüft.
- `pushCheck.location` — Der Ort des vollen Laufs: der Build-Dienst des Projekts. Gültig: `buildDienst`. Keine Vorgabe.
- `pushCheck.branch` — Der Prüfzweig, den /push-main vor dem Push pusht und danach löscht. Keine Vorgabe.

- `reviewScope` — Umfang des Review-Materials. Gültig: `diff`, `full`. Vorgabe: `diff`. Bestimmt, ob das Code-Review nur den Diff seit dem letzten Push oder den ganzen Quelltext liest; `full` setzen für ein Review des ganzen Projekts.

- `reviewModel` — Das Claude-Modell des Code-Reviews. Vorgabe: `claude-opus-4-8`. Das Claude-Modell, das den Code prüft; setzen, wenn ein anderes Modell als die Vorgabe prüfen soll.

- `reviewCommand` — Eine fremde CLI als Code-Reviewer, Gegenstück zu reviewModel. Vorgabe: nicht gesetzt, es prüft `reviewModel`. Lässt eine fremde CLI statt Claude den Code prüfen; setzen, wenn ein Modell eines anderen Anbieters prüfen soll.

- `reviewStages` — Besetzung und Blickwinkel der drei Prüfstufen: das fachliche Anliegen, der Plan dorthin, das einzelne Arbeitspaket. Vorgabe: je Stufe die Rollen des Rollenkatalogs, ein Reviewer je Rolle, nur, wenn der ganze Block fehlt; fehlt in einem vorhandenen Block eine Stufe oder ein Feld, bricht die Prüfung der Config ab. Bestimmt, wie viele Reviewer mit welchen Rollen je Stufe prüfen; setzen, wenn eine Stufe gründlicher oder sparsamer geprüft werden soll.
- `reviewStages.requirement` — Prüfung des fachlichen Anliegens ([Requirement]-Issue), bevor daraus ein Plan wird. Keine Vorgabe.
- `reviewStages.{requirement,plan}.reviewer` — Wie viele Reviewer diese Stufe prüfen. Werte: ab 1. Vorgabe: `2`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.requirement.roles` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung. Vorgabe: `form-beobachtbarkeit`, `abgrenzung`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.plan` — Prüfung des Plandokuments ([Plan]-Issue), bevor es in Arbeitspakete zerfällt. Keine Vorgabe.
- `reviewStages.plan.roles` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung. Vorgabe: `architektur-bestand`, `schnitt-abhaengigkeiten`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.issue` — Prüfung des einzelnen Arbeitspakets vor dem GO. Keine Vorgabe.
- `reviewStages.issue.reviewer` — Wie viele Reviewer diese Stufe prüfen. Werte: ab 1. Vorgabe: `1`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.issue.roles` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung. Vorgabe: `pruefbarkeit`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.

- `history` — Frühere Fachpläne zum selben Gegenstand. Vorgabe: `true`. Lässt Fachplan und Plan frühere Fachpläne zum selben Gegenstand nennen; nur mit `false` ausschalten, wenn die Vorgeschichte des Boards nicht zählt.

- `contractRepos` — Die Partnerrepos dieses Projekts. Vorgabe: `[]`, kein Partnerrepo. Verlangt von jedem Plan einen Abschnitt Verträge zu den Partnerrepos; eintragen, sobald ein anderes Repo einen Namen, ein Format oder ein Kennzeichen dieses Projekts liest oder schreibt.
- `contractRepos[].name` — Kurzname des Partnerrepos, etwa kanban-kit: Kleinbuchstaben und Ziffern, Wörter durch einzelne Bindestriche getrennt. Keine Vorgabe.
- `contractRepos[].url` — Adresse, von der sich das Partnerrepo klonen lässt, etwa https://github.com/mannewolff/kanban-kit.git. Keine Vorgabe.
- `contractRepos[].branch` — Hauptzweig des Partnerrepos: Gegen den gebauten Stand auf diesem Zweig wird ein Vertrag abgeglichen. Vorgabe: `main`.

### Vom Kit verwaltet

- `version` — _Vom Installer gesetzt._ Versionskennung x.y.z. Vorgabe: `1.4.0`.

- `provider` — _Veraltet._ Wird beim Laden auf `codeHost` und `issueTracker` übertragen; neu nicht setzen. Gültig: `github`, `gitlab`, `local`. Keine Vorgabe.

- `scaffoldOnly` — _Intern._ Pfade, die Testdateien nur als Gerüst anlegen — ihre Erwähnung in einer Testdatei belegt keine Kopplung. Vorgabe: `[]`.
- `scaffoldOnly[].pattern` — Pfadmuster wie in checkAreas: "*" innerhalb eines Segments, "**" über Segmentgrenzen hinweg, "/" als Trenner. Keine Vorgabe.
- `scaffoldOnly[].reason` — Warum keine Testdatei diesen Pfad prüft, sondern ihn höchstens als Gerüst anlegt. Keine Vorgabe.

- `scenariosFrom` — _Vom Installer gesetzt._ Stichtag der Szenarien-Pflicht als Kartennummer. Werte: ab 1. Vorgabe: nicht gesetzt, die Pflicht gilt für keine Karte am Board; der Installer setzt das Feld beim Update.

### Feinabstimmung

- `reviewReadLimit` — Der Nur-Lese-Schalter der fremden CLI aus reviewCommand. Vorgabe: für codex der eingebaute Schalter.

Die Phrasen, mit denen der Mensch an den drei Stop-Punkten freigibt.

- `triggers` — Trigger-Phrasen für die drei menschlichen Stop-Punkte. Vorgabe: die Werte der Felder darunter.
- `triggers.go` — Phrase für das GO zur Implementierung. Vorgabe: `GO`.
- `triggers.push` — Phrase für Push auf mainBranch (Schritt 7). Vorgabe: `push main`.
- `triggers.merge` — Phrase für PR nach productionBranch (Schritt 8). Vorgabe: `merge production`.

Die Namen der Spalten und Labels, wenn das Board sie anders nennt als das Kit.

- `columns` — Mapping der internen Status auf Board-Spalten- bzw. Label-Namen. Vorgabe: die Werte der Felder darunter.
- `columns.backlog` — Name der Spalte bzw. des Labels für Backlog; auf GitLab macht `Open` daraus den offenen Zustand ohne Label. Vorgabe: `Backlog`.
- `columns.ready` — Name der Spalte bzw. des Labels für Ready — freigegeben, das GO des Menschen. Vorgabe: `Ready`.
- `columns.in_progress` — Name der Spalte bzw. des Labels für In progress — das Arbeitspaket, an dem gerade gearbeitet wird. Vorgabe: `In progress`.
- `columns.in_review` — Name der Spalte bzw. des Labels für In review — lokal fertig, noch nicht gepusht. Vorgabe: `In review`.
- `columns.done` — Name der Spalte für Done auf GitHub und lokal; GitLab nimmt immer den geschlossenen Zustand. Vorgabe: `Done`.

Der Nachtbetrieb: welche Modelle laufen dürfen, wie lange eine Umsetzung dauern soll und wann ein Lauf als festgefahren gilt.

- `night` — Der Nachtbetrieb. Keine Vorgabe.

Die Budgets der Nacht-Kette: Zeit, Kosten und Korrekturrunden je Schritt, bevor die Kette abbricht.

- `night.chain` — Budgets und Kennzeichen der Nacht-Kette (night.mjs --chain). Keine Vorgabe.
- `night.chain.label` — Das Kennzeichen an der fachlichen Anforderung oder am Plandokument, das die Kette startet. Vorgabe: `kit:night`.
- `night.chain.variantBLabel` — Das Kennzeichen, das die gekennzeichnete Karte für die Umsetzungsstufe der Kette (Variante B) kennzeichnet. Vorgabe: `kit:carry-through`.
- `night.chain.planMin` — Zeitbudget der Stufe Plan in Minuten, einschliesslich Korrekturrunden. Vorgabe: `20`.
- `night.chain.packagesMin` — Zeitbudget der Stufe Pakete in Minuten, einschliesslich Korrekturrunden. Vorgabe: `15`.
- `night.chain.reviewMin` — Zeitbudget der Prüfer-Session am Plan in Minuten. Vorgabe: `15`.
- `night.chain.coverageMin` — Zeitbudget der Abdeckungs-Session in Minuten. Vorgabe: `10`.
- `night.chain.implementationMin` — Zeitbudget der Umsetzungsstufe (Variante B) in Minuten, über alle Implementierungs-Sessions der Kette. Vorgabe: `120`.
- `night.chain.preparationMin` — Frist der Vorbereitung des Push in Minuten, Warten und Prüflauf eingeschlossen. Vorgabe: `120`.
- `night.chain.costUsd` — Kostenbudget je Kette in US-Dollar, summiert über alle Sessions der Kette; geprüft nach jeder Session. Vorgabe: `50`.
- `night.chain.costUsdB` — Kostenbudget je Kette in US-Dollar für die Umsetzungsstufe (Variante B). Vorgabe: `150`.
- `night.chain.correctionRounds` — Höchstzahl der Korrektursessions je Dokument nach einer roten Formprüfung. Werte: ab 1. Vorgabe: `2`.
- `night.chain.transitions` — Welche Übergänge der Kette automatisch folgen dürfen. Vorgabe: jeder Übergang folgt, die Umsetzung nur an einer Karte mit dem Variante-B-Label.
- `night.chain.transitions.planReview` — Nach dem Plan folgt die Prüfung des Plans automatisch. Vorgabe: `true`.
- `night.chain.transitions.reviewPackages` — Nach der Prüfung des Plans folgen die Arbeitspakete automatisch. Vorgabe: `true`.
- `night.chain.transitions.packagesCoverage` — Nach den Arbeitspaketen folgt die Abdeckung gegen die fachliche Anforderung oder gegen den Plan automatisch. Vorgabe: `true`.
- `night.chain.transitions.coverageImplementation` — Nach der Abdeckung folgt die Umsetzung automatisch. Vorgabe: nur eine Karte mit dem Variante-B-Label wird umgesetzt.
- `night.chain.transitions.implementationPreparation` — Ob nach der Umsetzung die Vorbereitung des Push folgt. Vorgabe: `true`.

Wie eine Karte ihren Laufstand am Board zeigt: Labels, Frist und Pause.

- `night.status` — Der Laufstand einer Karte am Board. Vorgabe: die Werte der Felder darunter.
- `night.status.labels` — Die Namen der drei Laufstand-Labels. Vorgabe: die Werte der Felder darunter.
- `night.status.labels.running` — Label einer Karte, an der ein Lauf gerade arbeitet. Vorgabe: `run:running`.
- `night.status.labels.aborted` — Label einer technisch abgebrochenen Karte: Wiederholen genügt. Vorgabe: `run:aborted`.
- `night.status.labels.waiting` — Label einer wartenden Karte; worauf sie wartet, steht wörtlich im Laufstand. Vorgabe: `run:waiting`.
- `night.status.deadlineMin` — Erkennungsfrist in Minuten ab dem letzten Lebenszeichen eines Laufs. Vorgabe: `10`.
- `night.status.pauseMin` — Pause in Minuten vor dem einen automatischen Versuch nach einem Umgebungsfehler des lebenden Laufs. Vorgabe: `5`.
- `night.model` — Das Modell jeder Session des Nachtlaufs, die kein eigenes Modell hat. Vorgabe: das Modell, das der Nacht-Runner mitbringt.
- `night.models` — Die Modellnamen, die der Nacht-Runner starten darf, das stärkste zuerst. Vorgabe: leer, jede Session startet mit dem Modell des Laufs.

Welches Modell der Nachtlauf je Schwierigkeitsstufe eines Pakets startet.

- `night.tiers` — Modell oder Kommando je Schwierigkeitsstufe eines Arbeitspakets, geordnet hard/medium/easy. Vorgabe: keine Stufe, jedes Paket läuft mit dem Modell des Laufs.
- `night.tiers.hard` — Modell oder Kommando für eine schwere Aufgabe. Keine Vorgabe.
- `night.tiers.{hard,medium,easy}.model` — Modell-ID für diese Stufe. Keine Vorgabe.
- `night.tiers.{hard,medium,easy}.effort` — Gründlichkeit des Nachdenkens für diese Stufe, wird als --effort an die Claude-CLI gegeben. Gültig: `low`, `medium`, `high`, `xhigh`, `max`. Vorgabe: die Voreinstellung der Claude-CLI.
- `night.tiers.{hard,medium,easy}.command` — Kommandozeile eines fremden Programms für diese Stufe. Keine Vorgabe.
- `night.tiers.{hard,medium,easy}.name` — Selbstauskunft des Programms neben command. Keine Vorgabe.
- `night.tiers.medium` — Modell oder Kommando für eine mittelschwere Aufgabe. Keine Vorgabe.
- `night.tiers.easy` — Modell oder Kommando für eine leichte Aufgabe. Keine Vorgabe.
- `night.tierRule` — Ersetzt die mitgelieferte Regel, nach der /issues und /task die Stufe eines Arbeitspakets bestimmen. Vorgabe: die Regel des Kits.
- `night.stuckAfter` — Zahl gleich gescheiterter Läufe derselben Prüfung, nach der eine unbeaufsichtigte Sitzung gebremst wird. Werte: ab 2. Vorgabe: `3`.
- `night.goalImplementationMin` — Zielmarke für die Dauer einer Umsetzung in Minuten. Vorgabe: `10`.
- `night.logRetentionDays` — Frist in Tagen, nach der der Nacht-Runner seine Protokolle löscht. Werte: ab 1. Vorgabe: `14`.

Der tägliche Prüflauf: sein Label, seine Zeit und seine Kosten.

- `checkRun` — Der tägliche Prüflauf. Vorgabe: die Werte der Felder darunter.
- `checkRun.label` — Das Kennzeichen an der fachlichen Anforderung, die der Lauf prüfen lässt. Vorgabe: `kit:check`.
- `checkRun.checkMin` — Zeitbudget der Prüfer-Session je Karte in Minuten. Vorgabe: `25`.
- `checkRun.costUsd` — Kostenbudget je Lauf in US-Dollar, geprüft nach jeder Session. Vorgabe: `25`.

Die Schwellen, ab denen die Aufwandsauswertung einen Befund meldet.

- `workload` — Umfang und Schwellen der Aufwandsauswertung. Vorgabe: die Werte der Felder darunter.
- `workload.runs` — Wie viele der jüngsten abgeschlossenen Ergebnisstände die Auswertung höchstens einbezieht, die jüngsten zuerst. Vorgabe: `10`.
- `workload.thresholds` — Ab welchem Anteil die Auswertung einen Befund meldet. Vorgabe: die Werte der Felder darunter.
- `workload.thresholds.checkShare` — Höchster Anteil der größten Pflichtprüfung an der Prüfzeit ohne Befund. Werte: 0 bis 1. Vorgabe: `0.5`.
- `workload.thresholds.narrowingWithoutEffect` — Ob ein Befund erscheint, wenn die Eingrenzung der Prüfungen über Bereiche gemessen, aber nie gegriffen hat. Vorgabe: `true`.
- `workload.thresholds.toolShare` — Anteil, den reine Werkzeugarbeit an der gesamten Laufzeit einnehmen darf, bevor ein Befund erscheint. Werte: 0 bis 1. Vorgabe: `0.5`.
- `workload.thresholds.writeCostShare` — Höchster Anteil der Schreibkosten an den Gesamtkosten ohne Befund. Werte: 0 bis 1. Vorgabe: `0.75`.

Zeitfenster und Schwellen, nach denen die Wirksamkeitsauswertung eine Prüfung als wirkungslos meldet.

- `effectiveness` — Zeitfenster und Schwellen der Wirksamkeitsauswertung. Vorgabe: die Werte der Felder darunter.
- `effectiveness.windowDays` — Wie viele Tage zurück die Auswertung zählt. Vorgabe: `30`.
- `effectiveness.neverFlaggedFromRuns` — Ab wie vielen Ausführungen im Fenster eine Prüfung, die nie beanstandet hat, zum Befund wird. Vorgabe: `10`.
- `effectiveness.rateThreshold` — Ab welcher Rückläuferquote ein Befund erscheint. Werte: 0 bis 1. Vorgabe: `0.2`.
- `effectiveness.rateFromPackages` — Ab wie vielen gewerteten Arbeitspaketen im Fenster die Rückläuferquote einen Befund auslösen darf. Vorgabe: `10`.
- `effectiveness.candidatesMax` — Wie viele Karten die Rückläuferquote höchstens wertet, die jüngsten Eintritte in In review zuerst. Vorgabe: `200`.

Ab wie vielen wiederkehrenden Funden der Modell-Prüfungen ein Vorschlag entsteht.

- `findings` — Wiederkehrende Funde der Modell-Prüfungen: ab wie vielen Vorkommen aus ihnen ein Vorschlag entsteht. Vorgabe: die Werte der Felder darunter.
- `findings.threshold` — Ab wie vielen Vorkommen desselben Fundes ein Vorschlag entsteht. Vorgabe: `3`.
<!-- einstellungen:ende -->

## kontext.config.json

`/session-start` und `/document` lesen den Ort des Memory-Vaults aus `~/.claude/kontext.config.json` für alle Projekte auf dem Rechner und aus `.claude/kontext.config.json` für ein Projekt. Beide Dateien werden feldweise zusammengeführt, die Felder der Projektdatei gewinnen. Die Dateien gehören nicht ins Repository.

- `vault` — Absoluter Pfad zum Memory-Vault; ohne ihn schreibt `/document` den Tageslog ins Projektverzeichnis. Keine Vorgabe.
- `always` — Dateien relativ zum Vault, die `/session-start` immer liest. Vorgabe: `[]`.
- `projectDocs` — Dateien oder Glob-Muster relativ zum Projektverzeichnis, die `/session-start` liest. Vorgabe: `["CLAUDE-*", ".claude/CLAUDE-*"]`.
- `project` — Name des Projekts im Vault, nötig nur, wenn er vom Repo-Namen abweicht. Vorgabe: der Name des Repos.
- `logPath` — Muster der Tageslog-Datei relativ zum Vault, mit den Platzhaltern `{date}` und `{project}`; sobald zwei Projekte denselben Vault nutzen, gehört `{project}` hinein. Vorgabe: `Log/{date}.md`.
- `parentProject` — Dach-Projekt über mehreren Service-Repos, unter dem deren Notizen gemeinsam liegen. Keine Vorgabe.
