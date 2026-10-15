# Einrichtung

Jeder Teil dieser Seite sagt, was du tust und was du danach siehst. Jede einzelne Einstellung steht mit Wirkung und Vorgabe unter [Einstellungen](/einstellungen).

## Installation

**Was du tust.** Wechsle in deinen Projektordner und starte den Installer:

```bash
npx claude-workflow-kit
```

Ohne npm geht es auch so:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Der Installer fragt der Reihe nach:

1. **Sprache** des Kits, `de` oder `en`.
2. **Global oder projektlokal.** Global landen die Skills in `~/.claude/skills/` und gelten in allen Projekten. Projektlokal landen sie in `./.claude/skills/`; das ist der Weg für ein Team.
3. **Code-Host**: `github`, `gitlab` oder `local`.
4. **Issue-Tracker**: Vorgabe ist der Code-Host, jede andere Wahl ist möglich.
5. **Main-Branch** (Ziel von `/push-main`) und **Production-Branch** (Ziel von `/merge-production`).
6. **Review-Umfang**: `diff` zeigt dem Reviewer nur die geänderten Zeilen, `full` alle Dateien.
7. **Review-Modell oder Review-Kommando**, genau eines von beiden. Ein Modell läuft als Subagent; ein Kommando startet ein fremdes Werkzeug, das den Prompt über stdin bekommt.
8. **Commit-Gate** einhängen, nur projektlokal und nur, wenn kein anderer `core.hooksPath` gesetzt ist.
9. **Bereiche** und je vorhandener Prüfung ihre Zuordnung, nur projektlokal (siehe [Bereiche](#bereichsbezogene-prufungen-checkareas)); beim ersten Einrichten bietet der Installer dafür den Vorschlag aus `areas suggest` an. Eine leere Eingabe lässt alles, wie es ist.
10. **Vault-Pfad**, nur global. Mit Pfad schreibt der Installer `~/.claude/kontext.config.json`.

Bei `github` und projektlokaler Installation folgen auf die Code-Host-Frage drei Fragen zum **Schutz des Hauptzweigs**: ob das Projekt GitHub Actions hat, ob die Prüfung vor dem Push dorthin wandern und Haupt- und Veröffentlichungszweig geschützt werden sollen, und welcher Prüfzweig gilt (Vorgabe `kit-pruefung`). Mit Ja pusht der Installer zur Probe auf den Prüfzweig, wartet auf den Build-Dienst und meldet `scharf` (Rulesets gesetzt), `anleitung` (Probe bestanden, die Ausgabe nennt die Schritte bei GitHub), `offen` (kein Lauf des Build-Dienstes) oder `nicht moeglich`.

Ein bestehendes Projekt schaltet den Schutz mit `node install.mjs --protection` nachträglich ein; der Aufruf ändert nur `pushPruefung`. Den Zustand nennt jederzeit `node .claude/kit/board.mjs code protection status`.

**Was du danach siehst.** Starte Claude Code neu. Die siebzehn Skills erscheinen unter `/help`, und `/session-start` meldet den Stand des Projekts.

### Was der Installer schreibt

- die Skills unter `.claude/skills/`,
- `.claude/workflow.config.json` mit deinen Antworten,
- `CLAUDE-workflow.md` mit der Prozessbeschreibung und die Gate-Register `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md`,
- die Werkzeuge unter `.claude/kit/`: Board-Adapter `board.mjs`, Prüflauf `checks.mjs`, Nacht-Runner `night.mjs` und ihre Teile,
- bei projektlokaler Installation den Block in `.gitignore`, die Hooks in `.claude/settings.json` und das Commit-Gate unter `.githooks/`.

Alles unter `.claude/` außer der Config ist Generat: Der nächste Installer-Lauf schreibt es neu. Es gehört deshalb nicht ins Repo. Der Block in `.gitignore` beginnt so:

```gitignore
.claude/*
!.claude/workflow.config.json
.claude/workflow.config.local.json
```

Die erste Zeile muss `.claude/*` lauten, nicht `.claude/`: In ein ausgeschlossenes Verzeichnis steigt git nicht hinab, und die Ausnahme in der zweiten Zeile bliebe wirkungslos. Die weiteren Zeilen des Blocks nennen die Zustandsdateien der Werkzeuge. Die Config selbst überschreibt der Installer nicht, er mischt: Vorgaben, darüber die vorhandene Datei, zuoberst deine Antworten. Nicht abgefragte Felder wie `buildChecks` bleiben stehen. Die Config ist Team-Einstellung und gehört versioniert; einmal committen musst du sie selbst.

**Hooks.** Der Installer trägt drei Einträge in den `hooks`-Block in `.claude/settings.json` ein. Unter `SessionEnd` und `Stop` ruft Claude Code `node .claude/kit/board.mjs session report` auf; der Melder schickt den Verbrauch der Sitzung an den Leitstand des Boards, abschließend am Sitzungsende und gedrosselt je Zug. Er meldet nur beim Tracker `toolbox` mit projektgebundenem Token und schweigt sonst. Unter `PreToolUse` mit Matcher `Bash` steht der Hook `bash-check`. Er weist eine Bash-Zeile ab, die eine Ausnahme aus `sandbox.excludedCommands` mit Pipe, Umleitung oder Folgebefehl verbindet, denn dann liefe der Aufruf doch in der Sandbox. Außerdem weist er einen Aufruf mit `run_in_background` ab, sobald `KIT_AGENT_MODEL` gesetzt ist: Ohne Aufsicht hat eine Sitzung keinen Folge-Zug, und das Ergebnis ginge verloren. Interaktiv bleibt Hintergrundarbeit erlaubt. Eigene Einträge bleiben stehen.

**Abschalten.** Den Eintrag aus dem `hooks`-Block löschen. Die Datei ist nicht versioniert, die Entscheidung gilt für deine Maschine. Der nächste Installer-Lauf trägt ihn wieder ein; den Melder stellst du dauerhaft still, indem du ihm das Token nimmst.

**Die bekannte Lücke: Worktrees.** Ein frisch angelegter `git worktree` trägt nur versionierte Dateien, also weder `settings.json` noch `.claude/kit/`. Eine Sitzung darin meldet nichts und hat keinen Hook. Abhilfe: beides aus dem Hauptarbeitsbaum hinüberkopieren. Die Worktrees der Nacht-Kette meldet der Runner selbst.

### Geschützte Dateien

`.claude/settings.json`, `.claude/settings.local.json` und `.claude/hooks/` darf nur ein Mensch schreiben; Claude Code weist jeden Schreibzugriff darauf ab. Ein Arbeitspaket, das eine davon ändern muss, hält an. Das Label `kit:protected` ist wie `review:done` je Board einmal anzulegen; es zeigt anders als `kit:clarify` keine offene Frage, sondern eine wartende Handlung, und abnehmen darf es nur der Mensch. Der Halt-Kommentar beginnt mit `## Geschuetzte Datei` und nennt jede Datei samt der Zeile aus dem Paket.

Schon beim Schreiben eines Pakets prüft `issue check-form` die Formgates I7 bis I9: Die Aufgabe nennt mindestens eine Datei (I7), keine davon ist geschützt (I8), und sie nennt die Quelle statt der installierten Kopie unter `.claude/kit/` (I9). Welche geschützten Dateien ein Paket nennt und wie der Halt-Kommentar lautet, liefert `issue check-protected <id>`; mit `--path <pfad>` kommt ein beim Schreiben abgewiesener Pfad dazu. Im Nachtbericht steht ein solcher Halt mit der Art `geschuetzt`, getrennt von den offenen Fragen.

**Was du dann tust.** Die Änderung an der Datei selbst vornehmen und `kit:protected` abnehmen. Beim nächsten Anlauf gilt das Paket als freigegeben.

### Das Commit-Gate

Das Commit-Gate weist jeden Commit ab, dem kein grüner `node .claude/kit/checks.mjs run` auf demselben Stand vorausging. Es gilt für jeden Commit im Repo: aus den Skills, von Hand, aus einem GUI-Client. Ein Werkzeug ohne `node` im PATH wird abgewiesen.

Zwei versionierte Dateien tragen es: `.githooks/pre-commit` ruft `.githooks/gate.mjs` auf. Aktiv wird es über die lokale git-Config `core.hooksPath .githooks`, die der Installer setzt. Ist `core.hooksPath` schon belegt, etwa durch Husky, ändert er nichts; dann ergänzt du den eigenen Hook um `node .githooks/gate.mjs pre-commit`.

**Was es prüft.** Jeder Prüflauf schreibt `.claude/checks-summary.json`, mit einem Hash je geänderter Datei, gebildet vor dem ersten Kommando. Das Gate vergleicht diese Hashes mit dem Index, also mit dem, was wirklich committet wird. Grün ist der Commit nur, wenn der Lauf grün war und jede gestagte Datei mit passendem Hash darin steht.

**Was es nicht leistet.**

1. `--no-verify` umgeht den Hook. Der Git-Workflow verbietet das, mechanisch verhindert es nichts.
2. Ein frischer Klon hat das Gate erst nach einem Installer-Lauf oder `git config core.hooksPath .githooks`.
3. Mit eigenem Hook-Manager hängt das Projekt den Aufruf selbst ein.
4. Die Zusicherung gilt je committeter Datei, nicht für den Stand als Ganzes. Wer `A` committet und das zugehörige `B` liegen lässt, erzeugt einen Stand, den niemand geprüft hat.

Nachts wertet der Nacht-Runner den Nachweis zusätzlich nach jeder Runde; fehlt er oder ist er rot, gilt die Runde als Fehlschlag. Interaktiv greift niemand, dort bleibt das Gate die Sicherung.

### Welchen Stand hat meine Installation?

```bash
node .claude/kit/board.mjs --version
node .claude/kit/night.mjs --version
```

Beide nennen ihre Kit-Version; die aktuelle nennt `node install.mjs --version`. Liegt deine Kopie zurück, lässt du den Installer erneut laufen. Laufen die beiden Dateien auseinander, warnt der Nacht-Runner beim Start.

## Was ist der Vault?

Der Vault ist ein persönlicher Memory-Speicher außerhalb des Repos: Profil, Arbeitsregeln, Entscheidungen, Tages-Logs. `/session-start` lädt ihn, `/document` schreibt am Ende der Sitzung hinein. Ohne Vault laufen beide Skills im Degraded Mode.

**Was du tust.** Ein Verzeichnis anlegen und den Pfad in `~/.claude/kontext.config.json` eintragen; bei globaler Installation erledigt das der Installer. Die Felder stehen unter [kontext.config.json](/einstellungen#kontext-config-json). Erwartet wird diese Struktur:

```
/pfad/zum/vault/
  Index.md                   (always-Datei)
  Profil.md                  (always-Datei)
  Projekte/{repo-name}/{repo-name}.md
  Log/YYYY-MM-DD.md
```

`Projekte/` und `Log/` legst du einmal von Hand an.

**Was du danach siehst.** `/session-start` nennt zu Beginn, was es aus dem Vault geladen hat, und `/document` schreibt den Tageslog und die Projektnotiz.

## Die Config-Datei

`.claude/workflow.config.json` hält alles Projektspezifische. Die Skills lesen nur aus ihr:

```json
{
  "codeHost": "github",
  "issueTracker": "github",
  "buildChecks": ["<build-kommando>", "<test-kommando>"],
  "mutationCommand": "",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" },
  "github": { "projectNumber": 11 }
}
```

`buildChecks` enthält die Prüfkommandos, die `node .claude/kit/checks.mjs run` vor jedem Commit und `/push-main` vor dem Push ausführt: die betroffenen, ausgewählt nach den Bereichen, die das Paket berührt. Jede ausgeführte muss grün sein. `mutationCommand` läuft einmal in `checks.mjs run --stage push`, nach den `buildChecks`; sein Ergebnis wird nur berichtet und hält nicht an. Leer schaltet es ab. `triggers` hält die Phrasen der drei Stop-Punkte. `columns` benennt die Spalten des Boards um.

Statt die Datei von Hand zu bearbeiten, kannst du die [Einstellungs-Oberfläche](/einstellungen) nutzen. Sie prüft vor dem Speichern.

### Bereichsbezogene Prüfungen: `checkAreas`

Ein Eintrag in `buildChecks` kann sagen, für welche Bereiche er zuständig ist:

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

Der bloße Kommandostring läuft immer. `{ "cmd", "areas" }` läuft, wenn einer der Bereiche berührt ist. `{ "cmd", "always": true }` läuft immer.

String-Form und `always` verhalten sich gleich und sagen Verschiedenes: Der String kann vergessen sein, `always` ist entschieden.

`areas` und `always` schließen sich aus, und `areas` darf nicht leer sein.

`checkAreas` ordnet jedem Bereich Pfadmuster zu. `*` gilt innerhalb eines Pfadsegments, `**` über Segmentgrenzen hinweg; `/` ist der Trenner, auf den jeder Pfad normalisiert wird. Die Auswertung bringt das Kit mit, ohne Laufzeitabhängigkeit.

Die implement-Skills prüfen vor dem Commit gegen `HEAD`: Der Diff ist genau dieses Arbeitspaket. `/push-main` prüft vor dem Push gegen `git merge-base HEAD origin/<mainBranch>` und misst alles seit dem letzten Push.

Vertauscht ginge beides schief. `merge-base` vor dem Commit sammelte fremde Pakete ein, und ein Rot träfe das falsche Issue.

`HEAD` vor dem Push ließe die Zusammenfassung den falschen Stand bezeugen: Ihre Hashes beschrieben das letzte Paket statt des Batches, der hinausgeht, und genau diesen Nachweis liest das Commit-Gate.

**Im Zweifel läuft alles, nicht abschaltbar.** Den vollen Umfang ziehen eine Datei, die keinem Bereich zugeordnet ist, eine nicht zugeordnete Prüfung und ein leerer oder nicht auflösbarer Anker.

Landen Änderungen oft im vollen Umfang, gehört die Zuordnung verbessert, nicht die Regel aufgeweicht.

Dateien, zu denen es nichts zu prüfen gibt, stehen in `ohnePruefung`, je mit Muster und Pflichtgrund. Sie lösen keine Prüfung aus und stehen mit Grund im Bericht. Trifft eine Datei zugleich ein Muster aus `checkAreas`, gewinnt der Bereich. Eine JavaScript-Datei ohne Muster erbt die Bereiche der Dateien, die sie importieren.

Ohne `checkAreas` laufen alle Prüfungen unverändert; niemandem wird still Prüfung weggenommen.

`mutationCommand` ist nicht Teil der Auswahl und läuft an der Stufe `push` immer.

`node .claude/kit/checks.mjs plan` zeigt die Auswahl, ohne etwas auszuführen.

### Gestaffelte Prüfungen: `stufe`

Ein Eintrag kann sagen, wann er an der Reihe ist:

```json
{ "cmd": "mvn verify -Pintegration", "stufe": "push" }
```

| Stufe | Zeitpunkt | Skill |
| --- | --- | --- |
| `paket` | vor dem lokalen Commit | `/implement-next`, `/implement-ready`, `/implement-done` |
| `push` | vor dem Veröffentlichen auf main | `/push-main` |
| `merge` | vor der Freigabe nach production | `/merge-production` |

Die Stufen sind kumulativ, und jede Prüfung läuft einmal vor der Freigabe: `push main` fährt Paket- und Push-Stufe vollständig, `merge production` nur, was `push main` nicht geprüft hat. Keine Prüfung entfällt; eine spätere erscheint vorher als Auslassung mit ihrer Stufe als Grund, beim `merge production` etwa als `Stufe push, geprueft beim push main`. Fehlt das Feld, gilt `paket`, und der Bestand bleibt unverändert.

Ist ein Lauf der Paketstufe rot und `formatFixCommand` gesetzt, fährt `checks.mjs run` den Fix einmal und einen zweiten Durchgang; das ist keine Wiederholung im Sinn von `--retry`.

**Kurze Freigabe.** Lange Prüfungen auf die Stufe `push` statt `merge` stellen; der Preis: Jedes `push main` dauert um sie länger.

Mindestens eine Prüfung gehört auf die Paketstufe, sonst hat ein Arbeitspaket kein Gate, und der Nachtbetrieb startet nicht. `stufe` ist weder eine der `reviewStufen` noch die Aufgabenstufe der Nacht-Kette.

### Abschluss und Veröffentlichen: `nichtBeimAbschluss`

Eine Prüfung der Stufe `paket` kann beim Abschluss einer einzelnen Karte entfallen und erst vor dem Veröffentlichen laufen:

```json
{
  "buildChecks": [
    { "cmd": "mvn -q test", "areas": ["backend"] },
    { "cmd": "mvn -q verify -DskipUnitTests", "areas": ["backend"], "nichtBeimAbschluss": "zusammenspiel" },
    { "cmd": "mvn -q verify jacoco:check", "areas": ["backend"], "nichtBeimAbschluss": "volleTestmenge" }
  ]
}
```

Die Modultests (surefire) laufen bei jeder Karte. Die Integrationstests (failsafe) prüfen das Zusammenspiel, die Abdeckung (jacoco) braucht die volle Testmenge; beide laufen vor dem Veröffentlichen in `/push-main`. Auslassen darf nur der Abschlusslauf mit `--finish <kartennummer>`. Mit `abschlussBereiche` läuft die Prüfung trotzdem, wenn das Paket einen dieser Bereiche direkt berührt. Ein fehlendes Feld lässt alles, wie es ist.

### Wer war es? Die Verursachersuche

Wird ein Lauf mit `--stage push` rot, nennt er die Karten, deren Änderungen die rote Prüfung berühren. Die Nummer liest er aus der Commit-Botschaft, `(Issue #<n>)` im Betreff oder `Refs #<n>` im Rumpf. Ein Commit ohne erkennbare Nummer erscheint als `Commit ohne Karte <sha>`. Die Reparatur ist eine neue Karte; die genannte bleibt in In review.

### Was die Verkleinerung einbringt: die mittlere Prüfzeit je Karte

`node .claude/kit/effectiveness.mjs evaluate` schreibt `.claude/wirksamkeit.md`. Ein Block nennt die mittlere Prüfzeit je Karte über ihre Abschlussläufe, daneben den Vergleichswert ohne Auslassungen. Er ist eine Auskunft und kein Gate.

### Gütemessung und Marke: `guete`

Höchstens ein Eintrag darf eine Gütemessung sein: Sie misst, wie viele absichtlich eingebaute Fehler die Tests bemerken. Der Block `guete` trägt ein `muster`, einen regulären Ausdruck mit genau einer Gruppe für den Prozentwert, und eine `marke` von 0 bis 100:

```json
{ "cmd": "mvn -q org.pitest:pitest-maven:mutationCoverage", "stufe": "push", "guete": { "muster": "Killed \\d+ \\((\\d+)%\\)", "marke": 80 } }
```

| Werkzeug | Ausgabe | Muster |
| --- | --- | --- |
| PIT | `Killed 42 (84%)` | `Killed \\d+ \\((\\d+)%\\)` |
| Stryker | `Mutation score: 84.21` | `Mutation score: ([\\d.]+)` |

Ein Wert unter der Marke hält das Veröffentlichen an wie eine rote Pflichtprüfung, kein eigener Stop-Punkt; ein fehlender Wert ebenso. Ohne Benennung gibt es weder Messung noch Marke noch Halt. `mutationCommand` ist keine Gütemessung: Es trägt keine Marke und hält nichts an.

## Sprache

Das Kit spricht je Projekt Deutsch oder Englisch. Die Einstellung heißt `language`, Werte `de` und `en`, Vorgabe Deutsch. Ein neues Projekt wählt mit der ersten Frage des Installers.

**Was du tust, um umzustellen.**

```bash
node install.mjs --language en
```

Der Installer sichert die Config als `.claude/workflow.config.json.vor-umstellung`, setzt die Sprache und benennt die Einstellungen in beiden Config-Dateien in die Namen der neuen Sprache um. Selbst gewählte Werte wie eigene Labelnamen bleiben. Das Kit liest jede Einstellung unter ihrem deutschen und ihrem englischen Namen; stehen beide da, gilt der der Projektsprache.

**Was du danach siehst.** Unter `Umbenannt` jede umbenannte Einstellung mit beiden Namen. Unter `Offen`, was die Umstellung nicht erledigt, etwa Karten mit einem Titel-Präfix der anderen Sprache oder Labels, die am Board noch fehlen. Die letzte Zeile nennt den Rückweg, `node install.mjs --language de`.

Meldungen, Berichte, Kommentare an den Karten und die Oberflächen stehen ab dem nächsten Aufruf in der Projektsprache. Was schon am Board steht, bleibt. Zeilen, die das Kit später zurückliest, etwa `## Laufstand` oder `Autor-Modell:`, erkennt es in beiden Sprachen; welche Fassung es schreibt, gibt `node .claude/kit/board.mjs names` aus. JSON-Feldnamen, Dateinamen unter `.claude/` und die Formwörter der Befunde bleiben in beiden Sprachen gleich.

### Labels und Titel-Präfixe

Labels und Titel-Präfixe haben in jedem Projekt den englischen Namen.

| Sache | Name |
|-------|------|
| Frage wartet auf den Menschen | `kit:clarify` |
| geschützte Datei wartet auf den Menschen | `kit:protected` |
| Variante B der Nacht-Kette | `kit:carry-through` |
| Prüflauf | `kit:check` |
| Lauf läuft, abgebrochen, wartet | `run:running`, `run:aborted`, `run:waiting` |
| Spur der Prüfung | `review:done` |
| Fragen an den PO geklärt | `kit:clarified` |
| Fachplan wartet auf ein Ereignis | `kit:on-hold` |
| Ziel der Kette | `goal:plan`, `goal:packages`, `goal:implementation`, `goal:push-prepared` |
| Präfixe | `[Requirement]`, `[Idea]`, `[Plan]`, `[Human]`, `[Task]` |

Dazu kommen `kit:night`, `kit:nightrun`, `planreview:1` und `planreview:2`. Die deutschen Namen offener Karten erkennt das Kit mit; die Zuordnung steht unter [Namen für Umsteiger von Version 4](/dokumentation#namen-fur-umsteiger-von-version-4). `issue create --art requirement|plan|idea|human|task` setzt das passende Präfix selbst.

## Team-Config und persönliche Abweichungen

Die Config besteht aus zwei Dateien:

| Datei | Ort | Inhalt |
|---|---|---|
| `.claude/workflow.config.json` | im Repository | alles, was für das Team gilt |
| `.claude/workflow.config.local.json` | lokal, gitignored | persönliche Abweichungen |

Aus der lokalen Datei gelten nur diese Felder:

| Feld | Warum persönlich |
|---|---|
| `reviewModel` | Modellwahl ist Geschmack und Budget |
| `reviewCommand` | die fremde CLI ist lokal installiert |
| `reviewLesegrenze` | der Nur-Lese-Schalter dieser CLI |
| `reviewScope` | manche lesen lieber den vollen Quelltext |
| `triggers` | Tippgewohnheit für die Stop-Phrasen |
| `toolbox.tokenFile` | zeigt auf ein Token im eigenen Dateisystem |

Alles andere ignoriert das Kit und meldet es auf stderr. `buildChecks` und `columns` muss das ganze Team gleich sehen: Wer sein Gate lokal wegkonfigurieren könnte, hätte keins, und abweichende Spalten ergeben eine leere Issue-Liste statt eines Fehlers.

`reviewModel` und `reviewCommand` weichen als Paar. Setzt die lokale Datei eines davon, entfällt das andere aus der geteilten, und `reviewLesegrenze` fällt mit `reviewCommand`.

**Was du tust.** Persönliche Werte in `.claude/workflow.config.local.json` schreiben. **Was du siehst.** `git status` bleibt sauber; eine Änderung an der geteilten Datei zeigt es dagegen an.

## Eine Datei, ein Schreiber

Jede Datei im Vault, in die ein Skill von selbst schreibt, gehört genau einem Repo. Teilen sich mehrere Projekte einen Vault, schrieben sie sonst in denselben Tageslog, und eine synchronisierte Ablage erzeugte Konfliktkopien.

- **Tageslog je Projekt.** Sobald zwei Projekte denselben Vault nutzen, gehört `logPath` gesetzt, etwa `Log/{date}-{project}.md`. Die Vorgabe `Log/{date}.md` ist eine Datei je Tag. Die Felder stehen unter [kontext.config.json](/einstellungen#kontext-config-json).
- **Die gemeinsame Dach-Notiz** schreibt `/document` nie von selbst. Bei Wirkung über ein Projekt hinaus schlägt der Skill einen Eintrag vor und schreibt erst nach deiner Zustimmung.

## Issue-Tracker und Code-Host

Zwei unabhängige Einstellungen: `codeHost` für Repo und Pull Requests, `issueTracker` für Issues und Board. Alle Skills reden nur mit dem Board-Adapter `.claude/kit/board.mjs`; ändern sich die Werte, folgen sie beim nächsten Aufruf.

Das Board braucht fünf Spalten: Backlog, Ready, In progress, In review, Done. `issue list --status ready` liefert die Karten in der Reihenfolge der Spalte, oben zuerst; per Drag & Drop bestimmst du, was als Nächstes umgesetzt wird. Nur der Tracker `local` sortiert nach Nummer.

Die Labels des Kits legst du je Board einmal an, mindestens `kit:clarify`, `kit:protected` und `review:done`, für die Nacht-Kette dazu deren Labels aus der Tabelle oben.

### Herkunft am Board: `--derived-from`

`issue create --derived-from <nummer>` schickt die projektweite Kartennummer des nächsten Vorfahren mit. So kennt das Board die Kette von der fachlichen Anforderung über den Plan zum Arbeitspaket.

| Skill | Verweis |
|---|---|
| `/requirement` | nie, die fachliche Anforderung ist die Wurzel |
| `/task` | nie, ein `[Task]` hat keinen Vorfahren |
| `/techplan` | auf die fachliche Anforderung, aus der der Plan entsteht |
| `/issues` | auf das Plandokument, sonst auf die fachliche Anforderung |

Nur der Tracker `toolbox` wertet das Feld aus; GitHub, GitLab und local nehmen die Option an und übertragen sie nicht. Ein Server, der das Feld nicht kennt, schluckt es still: Exit 0, die Karte entsteht ohne Herkunft. Ein Rücklesen sichert das nicht ab, denn es scheitert an der Pool-Idee, die nicht lesbar ist.

Ein Projektwechsel löscht die Herkunft am Board, für die verschobene Karte und für alle, die auf sie zeigen. Die Zeilen `Plan: Issue #M` und `Fachliche Quelle: Issue #N` im Body sind die dauerhafte Form und bleiben darum stehen.

### GitHub

**Was du tippst.**

```bash
gh auth login
```

Dann ein GitHub Project mit den fünf Spalten anlegen und seine Nummer als `github.projectNumber` eintragen. Fehlt sie, nimmt der Adapter das einzige Project des Owners und sagt es auf stderr.

**Was du siehst.** Beim ersten Aufruf entsteht `.claude/board-meta-cache.json` mit den IDs des Projects. Löschst du sie, baut der Adapter sie neu auf.

### GitLab

```bash
glab auth login
```

Die fünf Spalten sind Labels, `~Backlog` bis `~Done`. Der Installer legt sie an, wenn du die Frage bejahst; die Board-Ansicht legst du einmal in der GitLab-Oberfläche an (Issues → Boards → Add list). `/merge-production` erstellt einen Merge Request statt eines Pull Requests.

### Lokal

Mit `issueTracker: local` braucht es nichts. Jede Karte ist eine Datei unter `issues/`, ihr Status steht im Frontmatter:

```markdown
---
id: 1
status: backlog
title: Beispiel-Issue
---
```

### Toolbox

Ein persönliches Kanban-Board mit eigenem Server; der Installer fragt nicht danach.

```json
{
  "issueTracker": "toolbox",
  "toolbox": { "host": "https://toolbox.example.org", "tokenFile": ".claude/tbx.token" }
}
```

Das Token kommt aus der ersten dieser Quellen: der Umgebungsvariable `TBX_TOKEN`, der Datei aus `toolbox.tokenFile` oder dem globalen Login `tbx auth login`. Ein Token im Klartext in der Config weist der Adapter ab. Die Token-Datei gehört in `.gitignore`:

```bash
echo "<token>" > .claude/tbx.token
echo ".claude/tbx.token" >> .gitignore
```

Die Spaltennamen sind fest. Neue Karten landen mit Nummer im Backlog; mit `ideaStored: true` landen sie stattdessen im Ideen-Pool. Endet ein Aufruf hinter einem Proxy mit „fetch failed“, fehlt `NODE_USE_ENV_PROXY=1`; `board.mjs` setzt es selbst, eigene Node-Aufrufe brauchen es auch.

### Tracker wechseln

Wechselt ein Projekt den Tracker, überführt `tools/migrate-issues.mjs` die offenen Issues von GitHub in die Toolbox:

```bash
node tools/migrate-issues.mjs export
node tools/migrate-issues.mjs import --file <exportdatei> --dry-run --out-dir <verzeichnis>
node tools/migrate-issues.mjs import --file <exportdatei> --yes
node tools/migrate-issues.mjs verify --in <exportdatei>
```

Vor dem ersten `--yes` verlangt das Werkzeug einen vollständigen `--dry-run`. Jede Karte behält ihre Nummer und ihre Kommentare samt Autor und Datum, trägt `externalKey: github#<N>` und beginnt mit zwei Herkunftszeilen:

```
> Quelle: https://github.com/<owner>/<repo>/issues/<N>
> Ursprüngliche Spalte: <Spaltenname oder keine>
```

Der Import ist über `externalKey` idempotent. `--from <N> --to <N>` holt ein einzelnes Issue, etwa einen Fehlerbericht, der später auf GitHub eingeht.

Danach `issueTracker` umstellen. Den alten Tracker nicht abschalten: Er ist das Archiv der geschlossenen Issues, und Commit-Botschaften verweisen auf seine Nummern. Den Nummernzähler des neuen Trackers setzt du über die höchste vergebene Nummer, damit keine Nummer zweimal vorkommt.

## Aktualisieren und mehrere Projekte

**Was du tust.** Den Installer im Projekt erneut laufen lassen. Er überschreibt Skills und Werkzeuge und mischt die Config: Deine Felder bleiben, nur die abgefragten nehmen deine neuen Antworten.

**Was du danach siehst.** `node .claude/kit/board.mjs --version` nennt die neue Version. Hat sich ein Name geändert, schreibt der Installer die Aufrufe um, die er selbst angelegt hat, und nennt jede andere Stelle mit altem und neuem Namen: in `.claude/settings.json`, `.claude/settings.local.json`, den Skripten der `package.json` und `crontab -l`.

Ein neues Projekt bekommt das Kit mit demselben Installer, oder du kopierst die `workflow.config.json` eines anderen Projekts und passt die Branch-Namen an. Teilen sich mehrere Projekte einen Toolbox-Server, bekommt jedes sein eigenes, projektgebundenes Token.

## Troubleshooting

**Die Skills fehlen unter `/help`.** Claude Code nach der Installation neu starten. Liegen die Skills in `~/.claude/skills/` oder `.claude/skills/`?

**`/implement-ready` meldet „Ready ist leer“.** Der Skill arbeitet nur Ready ab und zieht nichts aus dem Backlog nach. Eine Karte nach Ready ziehen.

**`/kit-review` bringt dünne Befunde.** `reviewScope` auf `full` stellen. Bei sehr großen Repos sprengt `full` das Kontextfenster; dann bei `diff` bleiben und Dateien im Prompt nennen.

**`/push-main` passiert nicht.** Der Skill startet nur auf die genaue Phrase, Vorgabe `push main`. Eine frühere Freigabe gilt nicht für neue Commits.

**`/session-start` oder `/document` meldet einen Fehler.** Liegt `kontext.config.json` in `~/.claude/` oder `.claude/`? Ist `gh` beziehungsweise `glab` angemeldet?

**Das Commit-Gate weist ab.** `node .claude/kit/checks.mjs run` auf dem Stand fahren, der committet werden soll, und keine Datei danach ändern.
