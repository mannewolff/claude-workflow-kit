---
name: push-main
description: Schritt 8 des 9-Schritt-Prozesses — pusht den aktuellen Commit-Batch auf main. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "push main" tippt.
user-invocable: true
disable-model-invocation: true
---

# Push Main

Schritt 8 des 9-Schritt-Prozesses: Den aktuellen Commit-Batch auf `origin/main` pushen.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen.

## Trigger-Phrase

Der Mensch tippt: `push main` (oder die in `.claude/workflow.config.json` unter `triggers.push` konfigurierte Phrase).

Eine frühere Push-Freigabe in derselben Session gilt **nicht** für neue Commits. Jeder Push braucht eine neue explizite Freigabe.

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin push main getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht gepusht. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

## Ablauf

**Fortschritt melden.** Jeder Schritt beginnt mit einer Zeile `Schritt k von n — <Name> (laeuft)`.
Der volle Lauf fährt **neun** Schritte, die Zeilen lauten dann `Schritt k von 9`. Das `n`
ist die Zahl der Schritte, die dieser Lauf tatsächlich fährt — ohne `RELEASING.md`
sind es weniger, und dann zählt die Zeile auch weniger. Der Grund
ist die Wartezeit: Der eine Prüflauf über den fertigen Stand dauert so lange wie der volle
`buildChecks`-Katalog, und wer davor sitzt, soll sehen, an welcher Stelle des Wegs er ist.

**Aufwand melden.** Noch vor dem ersten Schritt:

```bash
node .claude/kit/aufwand.mjs befund
```

Zeige die Ausgabe **unverändert**. Sie ist bereits die Form, in der der Aufwands-Befund an
beiden Ausgabestellen erscheint — hier und als Abschlussblock im Laufprotokoll eines
unbeaufsichtigten Laufs. Hier steht sie, weil das Veröffentlichen der eine Schritt bleibt,
den ein Mensch auslöst: Läuft nachts niemand mit, liest sonst womöglich niemand mehr, was
der Prozess gekostet hat.

Unmittelbar danach der zweite Befund:

```bash
node .claude/kit/wirksamkeit.mjs befund
```

Für ihn gelten **dieselben Regeln**: Ausgabe unverändert zeigen, und er liest allein
`.claude/wirksamkeit.json`, die der letzte unbeaufsichtigte Lauf hinterlassen hat. Er sagt,
welche Pflichtprüfung sich verdient hat, was sie kostet — und welche in ihrem Fenster nie
beanstandet hat. Auch er ist kein Gate.

Unmittelbar danach der dritte Befund:

```bash
node .claude/kit/befunde.mjs befund
```

Auch für ihn gelten **dieselben Regeln**, und er liest allein `.claude/befunde.json`. Er
sagt, welche Mangel-Art die Modell-Prüfungen wie oft gefunden haben und ob daraus schon
ein Vorschlag entstanden ist. Hier steht er, weil `/retro` nur alle ein bis zwei Wochen
läuft und die Zahl damit zu spät trüge. In einem Projekt **ohne Modell-Prüfungen** gibt es
kein Protokoll, der Befund bleibt leer, und das wird nicht kommentiert — die Abwesenheit
der Prüfung entscheidet das bereits, dafür braucht es keinen Schalter.

Eine **leere Ausgabe** heißt: kein Befund. Sie wird nicht kommentiert — kein „alles
unauffällig", keine leere Überschrift. Ein **Fehlschlag** des Kommandos wird in **einer
Zeile** vermerkt, und er hält nichts auf. Beides gilt **je Befund**: Ein leerer oder
gescheiterter Aufwands-Befund sagt nichts über die beiden anderen, und umgekehrt genauso.
Alle drei brauchen die Config nicht; sie lesen allein `.claude/aufwand.json`,
`.claude/wirksamkeit.json` beziehungsweise `.claude/befunde.json`. Fehlt die Datei, ist die
Ausgabe leer und der Exit-Code 0.

Dieser Block trägt bewusst **keine Nummer** und zählt in keiner Fortschrittszeile mit: Eine
Nummer verschöbe jede folgende Schrittzahl um eins und machte sämtliche Querverweise auf
„Schritt 4" und „Schritt 6" falsch. Die Fortschrittszeilen der neun Schritte bleiben
davon unberührt.

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Ziel-Branch (Default: `main`)
- `buildChecks`: Liste der Pflicht-Checks (dieselben, die `/local-check` ausführt)

### 2. Stand prüfen

```bash
git status
git log origin/main..HEAD --oneline
```

Zeige welche Commits gepusht werden. Der Mensch soll wissen, was fährt.

### 3. Worktree anlegen und mit `origin` zusammenführen

> `Schritt 3 von 9 — Worktree (laeuft)`

**Alles, was dieser Lauf erzeugt, prüft, committet und pusht, entsteht in einem eigenen
Worktree — nicht im Haupt-Working-Tree.** Dort kann gleichzeitig die Umsetzungsstufe des
Nacht-Runners bauen (Variante B). Am 2026-09-25 riss genau das in kanban-kit zweimal
dieselbe Kette ab: Der Runner fand die Release-Dateien als unkommittierte Reste und stoppte
hart. Dazu kommt, dass fremde, halbfertige Dateien im Haupt-Tree — etwa ein noch roter
TDD-Test — den Release-Prüflauf verfälschen würden.

```bash
node .claude/kit/worktree.mjs anlegen --praefix release --ref <mainBranch>
```

Das Kommando räumt liegengebliebene Release-Worktrees ab, legt den neuen außerhalb des
Repos an, spiegelt `.claude/` hinein (Kit-Kopie, Config, Token) und gibt den Pfad als JSON
aus. Die Worktrees der Nacht (`kette`, `pruefung`) bleiben unberührt.

Der Worktree setzt auf dem **lokalen** `<mainBranch>` auf — dem Batch, der hinausgehen
soll — und wird dort mit dem veröffentlichten Stand zusammengeführt:

```bash
cd <pfad>
git fetch origin <mainBranch>
git rebase origin/<mainBranch>
```

Das Rebase ist nötig, weil ein früherer Worktree-Release seinen Commit nur auf `origin`
gelegt hat; ohne es liefe der Push ins `non-fast-forward`. Schon übernommene Commits
überspringt das Rebase von selbst. **Ein Konflikt hält an:** kein Prüflauf, kein Commit,
kein Push. Der Skill meldet die Konfliktdateien, entfernt den Worktree (Schritt 8) und
endet — das Zusammenführen ist Handarbeit des Menschen.

**Alle Kommandos der Schritte 4 bis 7 laufen in diesem Worktree.** Der `cd`-Aufruf oben
steht deshalb als **eigenes** Kommando: Das Arbeitsverzeichnis bleibt für die folgenden
Aufrufe erhalten. Vor Schritt 6 wird das einmal mit `pwd` nachgesehen — ein Commit im
falschen Baum ist genau der Fehler, den dieser Schritt beseitigt.

**Abhängigkeiten im frischen Worktree.** Er trägt nur, was versioniert ist, plus das
gespiegelte `.claude/`. Braucht ein Pflichtcheck Abhängigkeiten **im Projektverzeichnis**
(`node_modules`, `.venv`, `vendor/`), fehlen sie dort und werden vor dem Prüflauf mit dem
Installationskommando des Projekts angelegt (`npm ci`, `uv sync`, …). **Nicht** aus der
Hauptkopie herüberkopieren oder verlinken: Ein geteiltes Bauverzeichnis ist genau die
Vermischung, die dieser Weg beendet — im Vorfall teilten sich zwei `mvn verify` dasselbe
`target/`. Caches **außerhalb** des Projektverzeichnisses (`~/.m2`, npm-Cache) gelten
weiter und brauchen nichts. Lässt sich die Installation nicht herstellen, endet der Lauf
**ohne Commit und ohne Push** mit diesem Grund: Ein Check, der an fehlenden Abhängigkeiten
scheitert, wird nie als grüner Lauf gemeldet und nie ausgelassen.

### 4. Release-Dateien erzeugen (falls `RELEASING.md` existiert)

> `Schritt 4 von 9 — Release-Dateien erzeugen (laeuft)`

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Push-Trigger (`push main`) beschriebenen Schritte aus —
  **bis zum ersten festschreibenden Schritt**, also typischerweise Bump, Stempel und
  Changelog. Nicht committen, nicht pushen: Das kommt aus Schritt 5 und 6.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 5.

**Fremde `RELEASING.md`.** Die Grenze ist der erste Schritt, der festschreibt oder
veröffentlicht (`git commit`, `git push`, `git tag`, ein Release-Kommando). Alles davor
fährt der Skill; ab dort übernimmt er mit Lauf, Commit und Push. Stehen **hinter** dem
ersten festschreibenden Schritt noch weitere Schritte, führt der Skill sie nach seinem
Commit aus und sagt das im Abschlussbericht.

Der Skill selbst kennt keine projektspezifische Versions- oder Release-Logik; diese lebt
ausschließlich in der `RELEASING.md` des jeweiligen Repos.

### 5. Der eine Prüflauf (Gate — vor Commit und Push)

> `Schritt 5 von 9 — Prueflauf (laeuft)`

Jetzt liegen alle Dateien des Wegs auf der Platte: die Release-Dateien aus Schritt 4 — **im
Worktree**, und dort misst der Lauf sie. Genau diesen Stand misst **ein** Lauf:

```bash
node .claude/kit/checks.mjs run --stufe push --since "$(git merge-base HEAD origin/<mainBranch>)"
```

`<mainBranch>` ist der Wert aus der Config (Default: `main`).

**Dieser Skill fährt die Push-Stufe, und die fährt den vollen Umfang.** Es laufen
zusätzlich zu den Prüfungen der Paketstufe alle, die ihr Projekt für den Zeitpunkt des
Veröffentlichens vorgesehen hat — und zwar **jede von ihnen**, auch bei unberührten
Bereichen und auch dann, wenn seit dem Anker nichts geändert wurde. Vor dem Push wird der
Stand gemessen, der hinausgeht, und der besteht aus mehr als dem letzten Arbeitspaket. Der
Lauf nennt die **zusätzlichen Prüfungen vorab** in einer eigenen Zeile (`Stufe push:
zusaetzlich zur Paketstufe laeuft …`) — er wird darum spürbar **länger dauern** als der
Lauf je Arbeitspaket in `/implement-next`. Das ist der vorgesehene Zeitpunkt und kein
Grund, ihn abzukürzen.

**Der Anker ist der Batch, nicht `HEAD`.** Er entscheidet nicht mehr, **was** läuft — an
dieser Stufe läuft ohnehin alles —, sondern welchen Stand die Zusammenfassung **bezeugt**:
`basis`, `geaendert` und die Blob-Hashes, gegen die das Commit-Gate den Index prüft. Ohne
`--since` nimmt `planen` in `kit/checks.mjs` `HEAD` als Basis, und der Nachweis spräche
dann über das letzte Stück statt über den Batch, der gleich hinausgeht.

- **Im Vordergrund ausführen** und die Exit-Codes ehrlich auswerten — niemals den
  Exit-Code durch ein nachgestelltes `echo` oder eine Umleitung maskieren. Den
  Rückgabewert jedes Prüfkommandos und die allgemeinen Fehlermerkmale in seiner
  Ausgabe liest `checks.mjs run` selbst; ein Treffer färbt die Prüfung rot.
- **Ein roter Lauf hält alles an:** kein Commit, kein Push. Klare Meldung, **welcher**
  Check mit welchem Fehler fehlschlug. Der Worktree wird trotzdem **abgebaut** (Schritt 8),
  und der Bericht sagt das: Der Bump ist seit Issue #656 idempotent, ein neuer Anlauf
  erzeugt ihn wieder — ein stehengebliebener Worktree wäre genau der Rest, den dieser Weg
  beseitigt.
- Ist `buildChecks` leer: Hinweis „Keine buildChecks konfiguriert." und weiter zu
  Schritt 6 (kein Abbruch).

Warum überhaupt noch ein Lauf, wenn `/implement-ready` und `/local-check` je Issue schon
prüften: Der Nachweis gehört zum **Commit**, und die Dateien aus Schritt 4 hat kein
früherer Lauf gesehen. Ohne Nachweis für genau diesen Stand weist das Commit-Gate den
Commit ab.

**Befunde buchen, wenn Code-Review-Befunde eingearbeitet wurden.** Sind vor diesem Push
Funde aus einem `/review` eingearbeitet worden, hält die Session das in einem
Einarbeitungs-Kommentar am Issue fest — übernommen / abgelehnt mit Grund je Fund, im Muster
von `/issue-review` —, ergänzt den Befunde-Text je Fundblock um die Zeile
`Uebernahme: uebernommen` beziehungsweise `Uebernahme: abgelehnt` und schreibt ihn nach der
Transportregel als eigene Datei außerhalb des Projektverzeichnisses:

```bash
node .claude/kit/befunde.mjs buchen --datei <tmpdir>/<id>-buchung.md --stufe code --karte <id>
```

**Gebucht wird im Worktree**, weil der Vergleichsstand die Zusammenfassung des Prüflaufs
liest — und die liegt dort. Die Buchung kommt in Schritt 8 in die Hauptkopie zurück, und
**erst dort** entsteht je Art ein Vorschlag: Die Schwelle zählt den Gesamtstand des
Projekts, und der steht in der Hauptkopie.

**Hier und nicht früher.** Der Vergleichsstand der Code-Stufe fragt, ob jede heute geänderte
Datei von `.claude/checks-summary.json` gedeckt ist. Vor Schritt 5 trüge die Zusammenfassung
den Stand **vor** der Einarbeitung, und jede dabei geänderte Datei machte den Stand
`nicht-vergleichbar`, obwohl die Pflichtprüfungen gleich darauf grün laufen. Nach dem
Prüflauf liegt eine Zusammenfassung über genau den Stand vor, auf dem gebucht wird.

Liegen keine Code-Review-Befunde vor, entfällt dieser Block **ohne Vermerk**. **Kein Gate:**
Ein Fehlschlag von `buchen` oder `vorschlag` wird in **einer Zeile** vermerkt und hält
Commit und Push nicht auf. Wie der Befund-Block vor Schritt 1 trägt dieser Block **keine
Nummer** und zählt in keiner Fortschrittszeile mit.

### 6. Der eine Commit

> `Schritt 6 von 9 — Commit (laeuft)`

**Im Worktree** — einmal `pwd` davor, siehe Schritt 3.

```bash
git add <die Dateien aus Schritt 4>
git commit -m "<Betreff nach der Regel unten>"
```

**Betreff.** Hat Schritt 4 Release-Dateien erzeugt: `chore: vX.Y.Z` mit der Kennung aus
dem Bump.

**Nie ein Suffix `(Issue #N)` am Betreffende.** Daran und nur daran liest
`tools/changelog.mjs` die Paketnummer, und dieser Commit ist kein Arbeitspaket. Er
erscheint weiterhin im Changelog, dann ohne Paketreferenz; das ist gewollt. Aus demselben
Grund stehen in der Botschaft **keine** `#N`-Referenzen auf Nicht-Pakete.

Committet wird nur bei tatsächlichem staged Diff. Ist aus Schritt 4 nichts entstanden,
gibt es nichts festzuschreiben; der Ablauf geht ohne Commit weiter zu Schritt 7, und der
Push fährt allein die Commits aus Schritt 2.

### 7. Pushen

> `Schritt 7 von 9 — Push (laeuft)`

Aus dem Worktree, der auf einem losgelösten `HEAD` steht:

```bash
git push origin HEAD:<mainBranch>
```

**Kein `--force`, auch nicht nach dem Rebase.** Der Push ist nach Schritt 3 ein
Fast-Forward; wird er abgewiesen, ist `origin` zwischenzeitlich weitergelaufen — dann endet
der Lauf mit dieser Meldung, und der Mensch entscheidet.

### 8. Rückweg, Nachziehen, Worktree abbauen

> `Schritt 8 von 9 — Rueckweg und Abbau (laeuft)`

Die drei Schritte laufen **immer**, auch nach einem roten Prüflauf, einem Rebase-Konflikt
oder einem abgewiesenen Push — ein liegengebliebener Worktree ist genau der Rest, den
dieser Weg beseitigt.

Erst das, was in der Hauptkopie weiterzählt:

```bash
node .claude/kit/worktree.mjs rueckweg <pfad>
```

Das Kommando ersetzt `.claude/checks-summary.json` der Hauptkopie durch die des Worktrees
(sie bezeugt den frisch gemessenen Stand), hängt das Ausführungsprotokoll
(`.claude/ausfuehrungen.tsv`) und die Befunde (`.claude/befunde.tsv`) an und nennt in
`befundeArten` die Arten, die damit die Schwelle erreichen. Für **jede** davon ein Aufruf:

```bash
node .claude/kit/befunde.mjs vorschlag --art <a>
```

Dann das lokale `<mainBranch>`, das nach dem Push aus dem Worktree hinter `origin`
zurückliegt:

```bash
node .claude/kit/worktree.mjs nachziehen-pruefen
```

- **`nachziehen: true`** — in der Hauptkopie `git fetch origin <mainBranch>` und
  `git rebase origin/<mainBranch>`.
- **`nachziehen: false`** — **nicht** nachziehen. Der Skill nennt den `grund` und gibt die
  beiden Kommandos als kopierbare Zeile aus. Ein Rebase unter einer laufenden Umsetzung
  verschöbe ihr den Boden, und in einem schmutzigen Baum hielte er ohnehin an.

Zuletzt der Abbau:

```bash
node .claude/kit/worktree.mjs entfernen <pfad>
```

### 9. Bestätigung

Melde den neuen Stand auf `origin/<mainBranch>` mit dem letzten Commit-Hash.

**Die Nachweiszeile, je erzeugtem Commit.** Nenne den Hash, das Ergebnis des deckenden
Laufs und dessen `zeitpunkt` aus der Prüf-Zusammenfassung (`.claude/checks-summary.json`,
Issue #655):

```
<hash> — gedeckt von: node --test, node tools/sync-blobs.mjs --check (gruen, 2026-09-16 08:14)
```

Gelesen wird die Zusammenfassung des **Worktrees** — dort lief die Prüfung. Nach Schritt 8
liegt sie in der Hauptkopie und sagt dasselbe; vor dem Abbau ist der Worktree die Quelle.
Der Zeitpunkt ist der Punkt: Er sagt, ob der Nachweis zu diesem Stand gehört oder von
einem früheren Lauf stammt. Hat Schritt 6 keinen Commit erzeugt, gehört auch **das** in
den Bericht — ein Lauf ohne Commit sieht sonst aus wie ein Lauf mit Commit.

**In den Bericht gehören außerdem:** der Pfad des Worktrees und sein Abbau, ob das lokale
`<mainBranch>` nachgezogen wurde oder mit welchem Grund nicht, und dass der
Haupt-Working-Tree unberührt geblieben ist.

**CI-Hinweis, abhängig vom `codeHost`.** Bei `github` und `gitlab` gehört in den Abschlussbericht: „Falls der Push einen CI-Lauf auslöst, wird er hier nicht gegatet; `merge production` prüft den Commit." Bei `local` entfällt der Hinweis ersatzlos. Der Zustand der CI wird hier **nicht abgefragt** — der Lauf zum eben gepushten Commit ist Sekunden später nie fertig, ein Gate müsste warten, und `push main` ist der häufige Trigger. Geprüft wird die CI am Release, in `/merge-production` (Issue #316).

Hinweis auf nächsten Schritt:
> "Commit-Batch gepusht. Wenn der Test-Server automatisch zieht: dort prüfen. Dann auf Wunsch \`merge production\` für den PR nach production."

## Was dieser Skill nicht tut

- Kein Commit und kein Push bei einem roten Prüflauf (Schritt 5)
- Kein Erzeugen, Prüfen oder Committen im Haupt-Working-Tree — das läuft ausschließlich im
  Worktree aus Schritt 3
- Kein zurückgelassener Worktree, auch nicht nach einem roten Lauf (Schritt 8)
- Kein Rebase des lokalen `<mainBranch>`, während eine Sperre des Nacht-Runners liegt oder
  der Haupt-Tree schmutzig ist (Schritt 8)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
- Kein Halt wegen des Aufwands-, des Wirksamkeits- oder des Befunds zu den
  Modell-Prüfungen: Alle drei sind **kein Gate**, weder ihr Inhalt noch ihr Fehlschlag
  hält das Veröffentlichen auf. Sie sagen, was auffällt — was daraus folgt, entscheidet
  der Mensch.
- Kein Halt wegen der Buchung der Code-Review-Befunde: Auch sie ist kein Gate, und sie
  bucht nichts ohne Übernahmevermerk — entschieden hat der Mensch, bevor eingearbeitet
  wurde.
