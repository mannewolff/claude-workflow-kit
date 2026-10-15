# Einstellungen

Das Kit liest seine Einstellungen aus `.claude/workflow.config.json` im Projekt. Die Datei gehört ins Repository und gilt für das ganze Team. Daneben darf `.claude/workflow.config.local.json` liegen, die nicht ins Repository gehört: Sie trägt persönliche Abweichungen, etwa ein anderes Review-Modell, eigene Trigger-Phrasen oder den Pfad zu einem Token. Was nur teamweit gilt, ignoriert das Kit in der persönlichen Datei.

Statt die Dateien von Hand zu bearbeiten, lassen sich die Einstellungen über eine lokale Oberfläche pflegen. Sie ist eine einzelne Datei, [settings.mjs](https://docs.mwolff.org/settings.mjs), und arbeitet über alle Projekte unter einem Ordner:

```bash
node settings.mjs ~/ki-projects
```

Die Adresse, die sie beim Start nennt, trägt ein Zugangstoken und ist nur von diesem Rechner erreichbar. Die Oberfläche gliedert die Einstellungen in die Teile Reviewer, Paarungen, Prüfstufen, Befunde, Prüfkommandos und Bereiche, Nacht-Kette, Aufwand, Wirksamkeit, Aufgabenstufen und einfache Gruppen. Sie zeigt zu jeder Einstellung, die persönlich abweichen darf, den Team-Wert, die persönliche Abweichung und den Wert, der gilt. Ungültige Werte weist sie vor dem Speichern mit Grund zurück, und gespeichert wird nur der geänderte Wert.

## Alle Einstellungen

<!-- einstellungen:start -->
_Dieser Abschnitt entsteht aus `templates/workflow.config.schema.json` mit `node tools/config-referenz.mjs`; Änderungen gehören ins Schema, nicht hierher._

- `language` — Sprache des Kits in diesem Projekt: de (Deutsch) oder en (Englisch). Gültig: `de`, `en`. Vorgabe: `de`.

- `codeHost` — Wo der Code liegt (Push, Pull Requests). Gültig: `github`, `gitlab`, `local`. Vorgabe: `github`.

- `issueTracker` — Wo die Issues verwaltet werden. Gültig: `github`, `gitlab`, `local`, `toolbox`. Vorgabe: `github`.

- `provider` — Wird beim Laden auf `codeHost` und `issueTracker` übertragen; neu nicht setzen. Gültig: `github`, `gitlab`, `local`. Keine Vorgabe.

- `buildChecks` — Kommandos, die checks.mjs run bei der Abschlussprüfung eines Pakets und bei push main ausführt (Build, Tests): zuerst die mit "vorab" gekennzeichneten nacheinander, dann die mit "gleichzeitig" gekennzeichneten gleichzeitig, danach die übrigen nacheinander in Config-Reihenfolge. Vorgabe: `[]`.
- `buildChecks[]` — Ein Prüfkommando, als Kommandostring oder als Objekt mit `cmd` und den Feldern darunter. Keine Vorgabe.
- `buildChecks[].cmd` — Die Kommandozeile, wie sie in der String-Form stünde. Keine Vorgabe.
- `buildChecks[].areas` — Bereichsnamen aus `checkAreas`; die Prüfung läuft, wenn einer davon berührt ist. Keine Vorgabe.
- `buildChecks[].always` — true = entschieden immer laufend, unabhängig von den berührten Bereichen. Keine Vorgabe.
- `buildChecks[].stage` — Wann die Prüfung an der Reihe ist: "paket" beim Abschluss eines Arbeitspakets, "push" vor dem Veröffentlichen, "merge" vor der Freigabe. Gültig: `paket`, `push`, `merge`. Vorgabe: `paket`.
- `buildChecks[].notAtCompletion` — Warum diese Prüfung den Abschluss eines einzelnen Arbeitspakets nicht tragen muss: "zusammenspiel" = sie prüft das Zusammenspiel mehrerer Teile, "volleTestmenge" = sie gewinnt ihren Befund aus der vollständigen Testmenge. Gültig: `zusammenspiel`, `volleTestmenge`. Vorgabe: nicht gesetzt, die Prüfung läuft auch beim Abschluss.
- `buildChecks[].completionAreas` — Bereichsnamen aus checkAreas, bei deren direkter Berührung eine Prüfung mit "nichtBeimAbschluss" auch beim Abschluss eines Arbeitspakets läuft. Vorgabe: nicht gesetzt, die Prüfung entfällt beim Abschluss.
- `buildChecks[].quality` — Benennt diese Prüfung als Gütemessung: Sie misst, wie viele absichtlich eingebauten Fehler die Tests bemerken, und ein Wert unter der Marke hält das Veröffentlichen an. Keine Vorgabe.
- `buildChecks[].quality.pattern` — Regulärer Ausdruck mit genau einer Gruppe; sie greift den gemessenen Prozentwert aus der Ausgabe des Kommandos. Keine Vorgabe.
- `buildChecks[].quality.marker` — Der Prozentwert, ab dem die Messung genügt. Werte: 0 bis 100. Keine Vorgabe.
- `buildChecks[].concurrent` — Ob diese Prüfung in "checks.mjs run" neben anderen laufen darf. Vorgabe: `false`.
- `buildChecks[].upfront` — Ob diese Prüfung in "checks.mjs run" vor allen anderen läuft. Vorgabe: `false`.
- `buildChecks[].kind` — Mit `hinweis` meldet die Prüfung nur und hält nie an. Gültig: `hinweis`. Vorgabe: eine gewöhnliche Prüfung, deren Rot den Lauf anhält.

- `checkAreas` — Benannte Bereiche des Projekts: Schlüssel ist der Bereichsname, Wert eine Liste von Pfadmustern. Keine Vorgabe.

- `noCheck` — Dateien, zu denen es ausdrücklich nichts zu prüfen gibt — die dritte Antwort neben "berührt einen Bereich" und "trifft kein Muster, also voller Umfang". Vorgabe: `[]`.
- `noCheck[].pattern` — Pfadmuster wie in checkAreas: "*" innerhalb eines Segments, "**" über Segmentgrenzen hinweg, "/" als Trenner. Keine Vorgabe.
- `noCheck[].reason` — Warum keine Prüfung den Inhalt dieser Datei liest. Keine Vorgabe.

- `coupledAreas` — Bereiche, die eine gemessene Kopplung in fast alle Prüfkommandos zwingt — etwa eine Datei, die fast jede Testgruppe lädt. Vorgabe: `[]`.
- `coupledAreas[].area` — Name des Bereichs, wie er in checkAreas steht. Keine Vorgabe.
- `coupledAreas[].reason` — Welche gemessene Kopplung den Bereich in fast alle Prüfkommandos zwingt. Keine Vorgabe.

- `testLocations` — Wo die eigenen Tests eines Bausteins liegen — daraus meldet issue check-form bei einem Plan Testhinweise: je eigener Test eines geführten Bausteins, den der Plan nicht nennt, ein Hinweis, der weder ok noch den Exit-Code berührt. Vorgabe: die Ablagen des Kits für TypeScript und Java.
- `testLocations[].source` — Muster der Quelldatei, etwa src/{pfad}/{name}.ts. Keine Vorgabe.
- `testLocations[].test` — Muster ihres eigenen Tests, mit denselben Platzhaltern und * innerhalb eines Segments, etwa src/{pfad}/{name}*.test.ts. Keine Vorgabe.
- `testLocations[].defaults` — Fügt die Vorgaben des Kits an dieser Stelle ein. Wert: `true`. Keine Vorgabe.

- `scaffoldOnly` — Pfade, die Testdateien nur als Gerüst anlegen — ihre Erwähnung in einer Testdatei belegt keine Kopplung. Vorgabe: `[]`.
- `scaffoldOnly[].pattern` — Pfadmuster wie in checkAreas: "*" innerhalb eines Segments, "**" über Segmentgrenzen hinweg, "/" als Trenner. Keine Vorgabe.
- `scaffoldOnly[].reason` — Warum keine Testdatei diesen Pfad prüft, sondern ihn höchstens als Gerüst anlegt. Keine Vorgabe.

- `mutationCommand` — Kommando für Mutations-Tests (optional). Vorgabe: leer.

- `qualityCommands` — Weitere Kommandos bzw. Kommando-Präfixe, die eine Gütemessung starten (optional). Vorgabe: `[]`.

- `formatFixCommand` — Kommando, das Formatierungsverstöße mechanisch behebt (z.B. 'mvn spotless:apply' oder 'npx prettier --write .'). Vorgabe: leer.

- `installCommand` — Kommando, das die Abhängigkeiten des Projekts im Projektverzeichnis herstellt (z.B. 'npm ci', 'uv sync', 'mvn -q dependency:go-offline'). Vorgabe: leer.

- `mainBranch` — Branch für lokale Commits und Push (Schritt 7). Vorgabe: `main`.

- `productionBranch` — Ziel-Branch für den PR in Schritt 8 (merge production). Vorgabe: `production`.

- `pushCheck` — Wo der volle Prüflauf vor 'push main' stattfindet. Gültig: `lokal`. Vorgabe: `lokal`.
- `pushCheck.location` — Der Ort des vollen Laufs: der Build-Dienst des Projekts. Gültig: `buildDienst`. Keine Vorgabe.
- `pushCheck.branch` — Der Prüfzweig, auf den /push-main den Stand vor dem Push pusht und den es danach wieder löscht. Keine Vorgabe.

- `reviewScope` — Umfang des Review-Materials: 'diff' = git diff seit letztem Push; 'full' = gesamter Quelltext. Gültig: `diff`, `full`. Vorgabe: `diff`.

- `reviewModel` — Die Claude-Variante des Reviewer-Paares reviewModel/reviewCommand: Modell-ID für den Reviewer-Subagent (Opus-Pin). Vorgabe: `claude-opus-4-8`.

- `reviewCommand` — Die Fremd-Variante des Reviewer-Paares reviewModel/reviewCommand: Kommandozeile einer fremden CLI (z.B. 'codex exec --model gpt-5'), die den Review-Prompt über stdin bekommt und ihre Antwort auf stdout schreibt. Vorgabe: nicht gesetzt, es prüft `reviewModel`.

- `reviewReadLimit` — Gehört zu reviewCommand: der Nur-Lese-Schalter der fremden CLI, den das Kit an die Kommandozeile hängt (z.B. '--sandbox read-only'), am Leerraum zerlegt wie reviewCommand. Vorgabe: für codex der eingebaute Schalter.

- `triggers` — Trigger-Phrasen für die drei menschlichen Stop-Punkte. Vorgabe: die Werte der Felder darunter.
- `triggers.go` — Phrase für das GO zur Implementierung. Vorgabe: `GO`.
- `triggers.push` — Phrase für Push auf mainBranch (Schritt 7). Vorgabe: `push main`.
- `triggers.merge` — Phrase für PR nach productionBranch (Schritt 8). Vorgabe: `merge production`.

- `local` — Einstellungen für den lokalen Issue-Tracker (issueTracker: 'local'). Vorgabe: die Werte der Felder darunter.
- `local.issuesDir` — Verzeichnis der Issue-Markdown-Dateien, relativ zum Projekt-Root. Vorgabe: `issues`.

- `columns` — Mapping der internen Status auf Board-Spalten- bzw. Label-Namen. Vorgabe: die Werte der Felder darunter.
- `columns.backlog` — Name der Spalte bzw. des Labels für Backlog; auf GitLab macht `Open` daraus den offenen Zustand ohne Label. Vorgabe: `Backlog`.
- `columns.ready` — Name der Spalte bzw. des Labels für Ready — freigegeben, das GO des Menschen. Vorgabe: `Ready`.
- `columns.in_progress` — Name der Spalte bzw. des Labels für In progress — das Arbeitspaket, an dem gerade gearbeitet wird. Vorgabe: `In progress`.
- `columns.in_review` — Name der Spalte bzw. des Labels für In review — lokal fertig, noch nicht gepusht. Vorgabe: `In review`.
- `columns.done` — Name der Spalte für Done auf GitHub und lokal; GitLab nimmt immer den geschlossenen Zustand. Vorgabe: `Done`.

- `github` — GitHub-spezifische Einstellungen. Keine Vorgabe.
- `github.projectNumber` — Nummer des GitHub Project Boards (gh project list). Werte: ab 1. Keine Vorgabe.

- `toolbox` — Einstellungen für den Toolbox-Issue-Tracker (issueTracker: 'toolbox'). Keine Vorgabe.
- `toolbox.host` — Basis-URL der Toolbox-Instanz. Keine Vorgabe.
- `toolbox.tokenFile` — Pfad (relativ zum Projektverzeichnis) zu einer Datei mit dem projekt-/board-gebundenen Token. Keine Vorgabe.

- `issueReview` — Issue-Review über mehrere Modelle. Keine Vorgabe.
- `issueReview.requiredBeforeReady` — Ist es true, stellt der Nacht-Runner Ready-Issues ohne Review-Marker kommentiert ins Backlog zurück. Vorgabe: `false`.
- `issueReview.reviewers` — Reihenfolge ist die Steuerung: Genommen werden die vordersten Einträge, die nicht der Autor sind; wie viele, sagt reviewStufen. Keine Vorgabe.
- `issueReview.reviewers[].name` — Kurzname, wird mit dem Autor-Modell des Issues verglichen. Keine Vorgabe.
- `issueReview.reviewers[].kind` — 'claude' läuft als Subagent über das Agent-Tool, 'command' als beliebiges fremdes CLI (Prompt über stdin). Gültig: `claude`, `command`. Keine Vorgabe.
- `issueReview.reviewers[].model` — Nur bei kind 'claude': Modell-Identifier. Keine Vorgabe.
- `issueReview.reviewers[].command` — Nur bei kind 'command': Kommandozeile, z.B. 'codex exec --model gpt-5'. Keine Vorgabe.
- `issueReview.reviewers[].readLimit` — Nur bei kind 'command': der Nur-Lese-Schalter des fremden Werkzeugs, den das Kit an die Kommandozeile hängt (z.B. '--sandbox read-only'), am Leerraum zerlegt wie command. Keine Vorgabe.
- `issueReview.pairs` — Explizite Zuordnung Autor -> Reviewer. Vorgabe: keine Zuordnung, es gilt die Reihenfolge in `reviewers`.

- `reviewStages` — Besetzung und Blickwinkel der drei Prüfstufen: das fachliche Anliegen, der Plan dorthin, das einzelne Arbeitspaket. Vorgabe: je Stufe die Rollen des Rollenkatalogs, ein Reviewer je Rolle, nur, wenn der ganze Block fehlt; fehlt in einem vorhandenen Block eine Stufe oder ein Feld, bricht die Prüfung der Config ab.
- `reviewStages.requirement` — Prüfung des fachlichen Anliegens ([Requirement]-Issue), bevor daraus ein Plan wird. Keine Vorgabe.
- `reviewStages.requirement.reviewer` — Wie viele Reviewer diese Stufe prüfen. Werte: ab 1. Vorgabe: `2`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.requirement.roles` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung. Vorgabe: `form-beobachtbarkeit`, `abgrenzung`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.plan` — Prüfung des Plandokuments ([Plan]-Issue), bevor es in Arbeitspakete zerfällt. Keine Vorgabe.
- `reviewStages.plan.reviewer` — Wie viele Reviewer diese Stufe prüfen. Werte: ab 1. Vorgabe: `2`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.plan.roles` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung. Vorgabe: `architektur-bestand`, `schnitt-abhaengigkeiten`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.issue` — Prüfung des einzelnen Arbeitspakets vor dem GO. Keine Vorgabe.
- `reviewStages.issue.reviewer` — Wie viele Reviewer diese Stufe prüfen. Werte: ab 1. Vorgabe: `1`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.
- `reviewStages.issue.roles` — Ein Rollenname je Reviewer, in der Reihenfolge der Zuteilung. Vorgabe: `pruefbarkeit`, nur, wenn der ganze Block `reviewStages` fehlt; ein vorhandener Block braucht das Feld.

- `night` — Der Nachtbetrieb. Keine Vorgabe.
- `night.chain` — Budgets und Kennzeichen der Nacht-Kette (night.mjs --chain). Keine Vorgabe.
- `night.chain.label` — Das Kennzeichen an der fachlichen Anforderung oder am Plandokument, das die Kette startet. Vorgabe: `kit:night`.
- `night.chain.variantBLabel` — Das Kennzeichen, das die gekennzeichnete Karte für die Umsetzungsstufe der Kette (Variante B) kennzeichnet. Vorgabe: `kit:carry-through`.
- `night.chain.planMin` — Zeitbudget der Stufe Plan in Minuten, einschliesslich Korrekturrunden. Vorgabe: `20`.
- `night.chain.packagesMin` — Zeitbudget der Stufe Pakete in Minuten, einschliesslich Korrekturrunden. Vorgabe: `15`.
- `night.chain.reviewMin` — Zeitbudget der Prüfer-Session am Plan in Minuten. Vorgabe: `15`.
- `night.chain.coverageMin` — Zeitbudget der Abdeckungs-Session in Minuten, die die Pakete gegen den Fachplan hält, oder gegen den Plan. Vorgabe: `10`.
- `night.chain.implementationMin` — Zeitbudget der Umsetzungsstufe (Variante B) in Minuten, über alle Implementierungs-Sessions der Kette. Vorgabe: `120`.
- `night.chain.preparationMin` — Frist der Vorbereitung des Push in Minuten, Warten und Prüflauf eingeschlossen: So lange wartet sie höchstens, bis in der Nacht nichts mehr baut. Vorgabe: `120`.
- `night.chain.costUsd` — Kostenbudget je Kette in US-Dollar, summiert über alle Sessions der Kette; geprüft nach jeder Session. Vorgabe: `50`.
- `night.chain.costUsdB` — Kostenbudget je Kette in US-Dollar für die Umsetzungsstufe (Variante B), summiert über alle Sessions der Kette; geprüft nach jeder Session. Vorgabe: `150`.
- `night.chain.correctionRounds` — Höchstzahl der Korrektursessions je Dokument nach einer roten Formprüfung. Werte: ab 1. Vorgabe: `2`.
- `night.chain.transitions` — Welche Übergänge der Kette automatisch folgen dürfen. Vorgabe: jeder Übergang folgt, die Umsetzung nur an einer Karte mit dem Variante-B-Label.
- `night.chain.transitions.planReview` — Nach dem Plan folgt die Prüfung des Plans automatisch. Vorgabe: `true`.
- `night.chain.transitions.reviewPackages` — Nach der Prüfung des Plans folgen die Arbeitspakete automatisch. Vorgabe: `true`.
- `night.chain.transitions.packagesCoverage` — Nach den Arbeitspaketen folgt die Abdeckung gegen die fachliche Anforderung oder gegen den Plan automatisch. Vorgabe: `true`.
- `night.chain.transitions.coverageImplementation` — Nach der Abdeckung folgt die Umsetzung automatisch. Vorgabe: nur eine Karte mit dem Variante-B-Label wird umgesetzt.
- `night.chain.transitions.implementationPreparation` — Nach der Umsetzung folgt die Vorbereitung des Push automatisch, wenn das Ziel der Karte so weit reicht. Vorgabe: `true`.
- `night.status` — Der Laufstand: wie eine Karte einer Kette oder Umsetzungsnacht ihren Stand am Board zeigt (board.mjs issue run-state). Vorgabe: die Werte der Felder darunter.
- `night.status.labels` — Die Namen der drei Laufstand-Labels. Vorgabe: die Werte der Felder darunter.
- `night.status.labels.running` — Label einer Karte, an der ein Lauf gerade arbeitet. Vorgabe: `run:running`.
- `night.status.labels.aborted` — Label einer technisch abgebrochenen Karte: Wiederholen genügt. Vorgabe: `run:aborted`.
- `night.status.labels.waiting` — Label einer wartenden Karte; worauf sie wartet, steht wörtlich im Laufstand. Vorgabe: `run:waiting`.
- `night.status.deadlineMin` — Erkennungsfrist in Minuten ab dem letzten Lebenszeichen eines Laufs; danach zeigt seine Karte den letzten Stand mit dem Zusatz 'nicht beendet'. Vorgabe: `10`.
- `night.status.pauseMin` — Pause in Minuten vor dem einen automatischen Versuch nach einem Umgebungsfehler des lebenden Laufs. Vorgabe: `5`.
- `night.model` — Das Modell des Nachtlaufs: Es startet jede Session ohne eigenes Modell — die Stufen Plan, Review und Abdeckung der Kette, die Korrekturrunden und jedes Paket ohne Aufgabenstufe. Vorgabe: das Modell, das der Nacht-Runner mitbringt.
- `night.models` — Die Modellnamen, die der Nacht-Runner starten darf — geordnet, absteigend nach Stärke: der erste Eintrag ist das stärkste, der letzte das schnellste Modell. Vorgabe: leer, jede Session startet mit dem Modell des Laufs.
- `night.tiers` — Modell oder Kommando je Schwierigkeitsstufe eines Arbeitspakets, geordnet schwer/mittel/leicht. Vorgabe: keine Stufe, jedes Paket läuft mit dem Modell des Laufs.
- `night.tiers.hard` — Modell oder Kommando für eine schwere Aufgabe. Keine Vorgabe.
- `night.tiers.hard.model` — Modell-ID für diese Stufe. Keine Vorgabe.
- `night.tiers.hard.effort` — Gründlichkeit des Nachdenkens für diese Stufe, wird als --effort an die Claude-CLI gegeben. Gültig: `low`, `medium`, `high`, `xhigh`, `max`. Vorgabe: die Voreinstellung der Claude-CLI.
- `night.tiers.hard.command` — Kommandozeile eines fremden Programms für diese Stufe — ein Projekt-Artefakt derselben Vertrauensstufe wie reviewCommand, das pattern ^claude- gilt hier nicht. Keine Vorgabe.
- `night.tiers.hard.name` — Selbstauskunft des Programms neben kommando. Keine Vorgabe.
- `night.tiers.medium` — Modell oder Kommando für eine mittelschwere Aufgabe. Keine Vorgabe.
- `night.tiers.medium.model` — Modell-ID für diese Stufe. Keine Vorgabe.
- `night.tiers.medium.effort` — Gründlichkeit des Nachdenkens für diese Stufe, wird als --effort an die Claude-CLI gegeben. Gültig: `low`, `medium`, `high`, `xhigh`, `max`. Vorgabe: die Voreinstellung der Claude-CLI.
- `night.tiers.medium.command` — Kommandozeile eines fremden Programms für diese Stufe — ein Projekt-Artefakt derselben Vertrauensstufe wie reviewCommand, das pattern ^claude- gilt hier nicht. Keine Vorgabe.
- `night.tiers.medium.name` — Selbstauskunft des Programms neben kommando. Keine Vorgabe.
- `night.tiers.easy` — Modell oder Kommando für eine leichte Aufgabe. Keine Vorgabe.
- `night.tiers.easy.model` — Modell-ID für diese Stufe. Keine Vorgabe.
- `night.tiers.easy.effort` — Gründlichkeit des Nachdenkens für diese Stufe, wird als --effort an die Claude-CLI gegeben. Gültig: `low`, `medium`, `high`, `xhigh`, `max`. Vorgabe: die Voreinstellung der Claude-CLI.
- `night.tiers.easy.command` — Kommandozeile eines fremden Programms für diese Stufe — ein Projekt-Artefakt derselben Vertrauensstufe wie reviewCommand, das pattern ^claude- gilt hier nicht. Keine Vorgabe.
- `night.tiers.easy.name` — Selbstauskunft des Programms neben kommando. Keine Vorgabe.
- `night.tierRule` — Ersetzt die mitgelieferte Regel, nach der /issues und /task die Stufe eines Arbeitspakets bestimmen. Vorgabe: die Regel des Kits.
- `night.stuckAfter` — Zahl gleich gescheiterter Läufe derselben Prüfung, nach der eine unbeaufsichtigte Sitzung beim nächsten Prüfaufruf gebremst wird; interaktiv gibt dieselbe Zahl nur einen Hinweis. Werte: ab 2. Vorgabe: `3`.
- `night.goalImplementationMin` — Zielmarke für die Dauer einer Umsetzung in Minuten; der Bericht weist aus, wie viele Pakete darunter blieben. Vorgabe: `10`.
- `night.logRetentionDays` — Frist in Tagen, nach der der Nacht-Runner seine Protokolle löscht, einmal zu Beginn jedes Laufs: die Tagesprotokolle .claude/night-run-`<datum>`.log und die Laufordner unter .claude/protokolle/, gemessen an ihrer letzten Änderung. Werte: ab 1. Vorgabe: `14`.

- `checkRun` — Der Prüflauf: ein Lauf am Tag, der mehrere gekennzeichnete fachliche Anforderungen nacheinander prüfen lässt, ohne dass jemand zusieht. Vorgabe: die Werte der Felder darunter.
- `checkRun.label` — Das Kennzeichen an der fachlichen Anforderung, die der Lauf prüfen lässt. Vorgabe: `kit:check`.
- `checkRun.checkMin` — Zeitbudget der Prüfer-Session je Karte in Minuten. Vorgabe: `25`.
- `checkRun.costUsd` — Kostenbudget je Lauf in US-Dollar, summiert über alle Sessions des Laufs; geprüft nach jeder Session, nie mittendrin. Vorgabe: `25`.

- `workload` — Der Aufwand des Prozesses (unbeaufsichtigte Läufe): wie viele Ergebnisstände die Auswertung betrachtet und ab welchen Schwellen sie einen Befund meldet. Vorgabe: die Werte der Felder darunter.
- `workload.runs` — Wie viele der jüngsten abgeschlossenen Ergebnisstände die Auswertung höchstens einbezieht, die jüngsten zuerst. Vorgabe: `10`.
- `workload.thresholds` — Ab welchem Anteil die Auswertung einen Befund meldet. Vorgabe: die Werte der Felder darunter.
- `workload.thresholds.checkShare` — Anteil, den die größte einzelne Pflichtprüfung an der gesamten Prüfzeit einnehmen darf, bevor ein Befund erscheint. Werte: 0 bis 1. Vorgabe: `0.5`.
- `workload.thresholds.narrowingWithoutEffect` — Ob ein Befund erscheint, wenn die Eingrenzung der Prüfungen über Bereiche gemessen, aber nie gegriffen hat. Vorgabe: `true`.
- `workload.thresholds.toolShare` — Anteil, den reine Werkzeugarbeit an der gesamten Laufzeit einnehmen darf, bevor ein Befund erscheint. Werte: 0 bis 1. Vorgabe: `0.5`.
- `workload.thresholds.writeCostShare` — Anteil, den die Kosten des dritten Postens (Schreiben) an den Gesamtkosten einnehmen dürfen, bevor ein Befund erscheint. Werte: 0 bis 1. Vorgabe: `0.75`.

- `effectiveness` — Die Wirksamkeit der Prüfungen: über welches Zeitfenster die Auswertung Ausführungen und Beanstandungen zählt und ab welchen Mengen und Schwellen sie einen Befund meldet. Vorgabe: die Werte der Felder darunter.
- `effectiveness.windowDays` — Wie viele Tage zurück die Auswertung zählt. Vorgabe: `30`.
- `effectiveness.neverFlaggedFromRuns` — Ab wie vielen Ausführungen im Fenster eine Prüfung, die nie beanstandet hat, zum Befund wird. Vorgabe: `10`.
- `effectiveness.rateThreshold` — Ab welcher Rückläuferquote ein Befund erscheint. Werte: 0 bis 1. Vorgabe: `0.2`.
- `effectiveness.rateFromPackages` — Ab wie vielen gewerteten Arbeitspaketen im Fenster die Rückläuferquote einen Befund auslösen darf. Vorgabe: `10`.
- `effectiveness.candidatesMax` — Wie viele Karten die Rückläuferquote höchstens wertet, die jüngsten Eintritte in In review zuerst. Vorgabe: `200`.

- `findings` — Wiederkehrende Funde der Modell-Prüfungen: ab wie vielen Vorkommen aus ihnen ein Vorschlag entsteht. Vorgabe: die Werte der Felder darunter.
- `findings.threshold` — Ab wie vielen Vorkommen desselben Fundes ein Vorschlag entsteht. Vorgabe: `3`.

- `history` — Sucht vor dem Schreiben eines Fachplans oder Plans frühere Fachpläne des eigenen Boards zum selben Gegenstand, archivierte eingeschlossen, und nennt die einschlägigen im neuen Dokument. Vorgabe: `true`.

- `scenariosFrom` — Stichtag der Szenarien-Pflicht: die Kartennummer, ab der ein Fachplan am Board einen Abschnitt Szenarien mit mindestens einem vollständigen Szenario tragen muss. Werte: ab 1. Vorgabe: nicht gesetzt, die Pflicht gilt für keine Karte am Board; der Installer setzt das Feld beim Update.

- `contractRepos` — Die Partnerrepos dieses Projekts: Repos, die etwas lesen oder schreiben, das auch dieses Projekt festlegt — einen Namen, ein Kennzeichen, ein Format. Vorgabe: `[]`, kein Partnerrepo.
- `contractRepos[].name` — Kurzname des Partnerrepos, etwa kanban-kit: Kleinbuchstaben und Ziffern, Wörter durch einzelne Bindestriche getrennt. Keine Vorgabe.
- `contractRepos[].url` — Adresse, von der sich das Partnerrepo klonen lässt, etwa https://github.com/mannewolff/kanban-kit.git. Keine Vorgabe.
- `contractRepos[].branch` — Hauptzweig des Partnerrepos: Gegen den gebauten Stand auf diesem Zweig wird ein Vertrag abgeglichen. Vorgabe: `main`.
<!-- einstellungen:ende -->

## kontext.config.json

`/session-start` und `/document` lesen den Ort des Memory-Vaults aus `~/.claude/kontext.config.json` für alle Projekte auf dem Rechner und aus `.claude/kontext.config.json` für ein Projekt. Beide Dateien werden feldweise zusammengeführt, die Felder der Projektdatei gewinnen. Die Dateien gehören nicht ins Repository.

- `vault` — Absoluter Pfad zum Memory-Vault; ohne ihn schreibt `/document` den Tageslog ins Projektverzeichnis. Keine Vorgabe.
- `always` — Dateien relativ zum Vault, die `/session-start` immer liest. Vorgabe: `[]`.
- `projectDocs` — Dateien oder Glob-Muster relativ zum Projektverzeichnis, die `/session-start` liest. Vorgabe: `["CLAUDE-*", ".claude/CLAUDE-*"]`.
- `project` — Name des Projekts im Vault, nötig nur, wenn er vom Repo-Namen abweicht. Vorgabe: der Name des Repos.
- `logPath` — Muster der Tageslog-Datei relativ zum Vault, mit den Platzhaltern `{date}` und `{project}`; sobald zwei Projekte denselben Vault nutzen, gehört `{project}` hinein. Vorgabe: `Log/{date}.md`.
- `parentProject` — Dach-Projekt über mehreren Service-Repos, unter dem deren Notizen gemeinsam liegen. Keine Vorgabe.
