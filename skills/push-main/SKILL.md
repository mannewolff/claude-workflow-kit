---
name: push-main
description: Schritt 8 des 9-Schritt-Prozesses — pusht den aktuellen Commit-Batch auf main. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "push main" tippt. Einzige Ausnahme ist der Modus `vorbereiten`: Er pusht nicht und darf darum vom Nacht-Runner ohne Phrase gestartet werden.
user-invocable: true
disable-model-invocation: true
---

# Push Main

Schritt 8 des 9-Schritt-Prozesses: Den aktuellen Commit-Batch auf `origin/main` pushen.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen — ausgenommen der Modus `vorbereiten`, siehe den Abschnitt „Trigger-Phrase".

## Trigger-Phrase

Der Mensch tippt: `push main` (oder die in `.claude/workflow.config.json` unter `triggers.push` konfigurierte Phrase).

Eine frühere Push-Freigabe in derselben Session gilt **nicht** für neue Commits. Jeder Push braucht eine neue explizite Freigabe.

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin push main getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht gepusht. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

**Einzige Ausnahme: der Modus `vorbereiten`.** `/push-main vorbereiten` pusht nicht — weder
`<mainBranch>` noch einen Prüf- oder Vorab-Zweig — und darf darum vom Nacht-Runner ohne
Phrase gestartet werden. Er endet beim lokalen Commit `chore: vX.Y.Z` in einem eigenen
Worktree, siehe den Abschnitt „Modus `vorbereiten` (unbeaufsichtigt)". Den Push gibt
weiterhin nur die getippte Phrase frei; sie übernimmt morgens den vorbereiteten Stand
(Schritt 3).

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
- `pushPruefung`: wo der volle Lauf stattfindet — `"lokal"` ist die Vorgabe, ein Objekt
  `{ "ort": "buildDienst", "zweig": "<name>" }` verlegt ihn in den Build-Dienst. Der Skill
  liest den Wert nicht selbst aus der Config, sondern aus dem Feld `pushPruefung` von:

  ```bash
  node .claude/kit/checks.mjs plan --stufe push
  ```

  Bei `"lokal"` gelten die Schritte unten unverändert. Bei `buildDienst` ersetzt der
  Abschnitt „Weg über den Build-Dienst" den Prüflauf in Schritt 5 und den Push in
  Schritt 7; alle anderen Schritte bleiben. Endet der Aufruf mit einem Fehler (ungültiger
  Wert), hält der Skill an — kein Rückfall auf den lokalen Weg.

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

Zuerst holt die **Hauptkopie** den veröffentlichten Stand und fragt, ob eine Vorbereitung
der Nacht übernommen werden darf — in dieser Reihenfolge:

```bash
git fetch origin <mainBranch>
node .claude/kit/worktree.mjs vorbereitung-pruefen
```

Das Kommando holt selbst nichts; es vergleicht die Datei `.claude/push-vorbereitung.json`
mit dem eben geholten Stand (Plan #1243, E10). Danach entsteht der Worktree:

- **`uebernehmen: true`** — auf dem vorbereiteten Commit:

  ```bash
  node .claude/kit/worktree.mjs anlegen --praefix release --ref refs/kit/push-vorbereitet
  ```

- **`uebernehmen: false`** — wie bisher auf dem lokalen `<mainBranch>`:

  ```bash
  node .claude/kit/worktree.mjs anlegen --praefix release --ref <mainBranch>
  ```

**Nach dem Push und bei jedem Nicht-Übernehmen** werden Datei und Referenz verworfen —
beim Nicht-Übernehmen sofort hier, sonst nach dem Push in Schritt 7:

```bash
node .claude/kit/worktree.mjs vorbereitung-pruefen --verwerfen
```

Beim Nicht-Übernehmen nennt der Skill den `grund` in einer Zeile; fehlt die Datei, entfällt
die Zeile.

Das Kommando `anlegen` räumt liegengebliebene Release-Worktrees ab, legt den neuen außerhalb des
Repos an, spiegelt `.claude/` hinein (Kit-Kopie, Config, Token) und gibt den Pfad als JSON
aus. Die Worktrees der Nacht (`kette`, `pruefung`) bleiben unberührt.

Der Worktree setzt auf dem **lokalen** `<mainBranch>` auf — dem Batch, der hinausgehen
soll — oder auf dem vorbereiteten Commit, und wird dort mit dem veröffentlichten Stand
zusammengeführt. Geholt hat ihn die Hauptkopie schon; der Worktree teilt ihre Referenzen:

```bash
git -C <pfad> rebase origin/<mainBranch>
```

Das Rebase ist nötig, weil ein früherer Worktree-Release seinen Commit nur auf `origin`
gelegt hat; ohne es liefe der Push ins `non-fast-forward`. Schon übernommene Commits
überspringt das Rebase von selbst. **Ein Konflikt hält an:** kein Prüflauf, kein Commit,
kein Push. Der Skill meldet die Konfliktdateien, entfernt den Worktree (Schritt 8) und
endet — das Zusammenführen ist Handarbeit des Menschen.

**Alle Kommandos der Schritte 4 bis 7 laufen in diesem Worktree — ohne `cd`.** Claude Code
setzt das Arbeitsverzeichnis außerhalb der erlaubten Verzeichnisse nach jedem Aufruf zurück,
und ein zusammengesetzter Aufruf mit vorangestelltem `cd` fällt nicht mehr unter
`sandbox.excludedCommands` — der Prüflauf liefe in der Sandbox (Issue #1372). Darum nennt
jeder Aufruf den Worktree selbst und steht allein:

- **git:** `git -C <pfad> …`
- **der Prüflauf:** `checks.mjs run --in <pfad> …` (Schritt 5)
- **jedes andere Kommando**, etwa aus `RELEASING.md`:
  `node .claude/kit/worktree.mjs im <pfad> -- <kommando> [argumente]` — es startet das
  Kommando ohne Shell mit dem Worktree als Arbeitsverzeichnis und reicht Ausgabe und
  Exitcode durch.

Ein Commit im falschen Baum ist genau der Fehler, den dieser Schritt beseitigt; mit `-C`
und `--in` steht der Baum in jedem Aufruf.

**Bei Übernahme entfallen die Schritte 4 bis 6.** Der vorbereitete Commit trägt Bump und
Changelog schon, und sein Prüflauf war grün; ein zweiter Bump wäre eine weitere Version.
Statt der drei Schritte steht eine Zeile mit `zeitpunkt` und `commit` aus der Ausgabe von
`vorbereitung-pruefen`:

> `Übernimmt den Stand der Nacht vom <zeitpunkt> (<commit>)`

Schritt 7 fährt dann, was nachts offen blieb (das Feld `offen`): den Vor-Push-Schritt aus
`RELEASING.md` wie beschrieben. Auf dem Weg über den Build-Dienst ist das der Push auf den
Prüfzweig, das Warten auf den Build-Dienst und der Push auf `<mainBranch>` nur bei Grün,
wie im Abschnitt „Weg über den Build-Dienst" (Plan #1243, E17). Eine offene UI-Prüfung
wird vor dem Push als Frage an den Menschen gestellt; pusht wird nur nach seinem `ja`.
Ein offener Punkt `Gewackelt: <cmd> — Entscheidung beim push main` (ein Wackler im Lauf
der Nacht, Plan #1395, E14) wird wie jeder offene Punkt vor dem Push in Schritt 7 erfragt,
mit der Frage aus Schritt 5: Der Skill nennt die Prüfung und die Reparaturkandidaten aus
`wirksamkeit.mjs kandidaten` und fragt „Trotzdem fortfahren? (ja/nein)“; nur `ja` pusht.
Die Fortschrittszeilen zählen die entfallenen Schritte nicht mit.

**Abhängigkeiten im frischen Worktree.** Er trägt nur, was versioniert ist, plus das
gespiegelte `.claude/`. Braucht ein Pflichtcheck Abhängigkeiten **im Projektverzeichnis**
(`node_modules`, `.venv`, `vendor/`), fehlen sie dort. Ist `installCommand` in der Config
gesetzt, stellt `worktree.mjs anlegen` sie bereits selbst her — das Feld nennt das
Installationskommando des Projekts (`npm ci`, `uv sync`, …), und ein roter Lauf baut den
Worktree wieder ab. Ohne gesetztes Feld bleibt es am Aufrufer: Dann werden sie vor dem
Prüflauf von Hand angelegt. **Nicht** aus der
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
  Changelog. Nicht committen, nicht pushen: Das kommt aus Schritt 5 und 6. Jeder Schritt
  läuft im Worktree über `node .claude/kit/worktree.mjs im <pfad> -- <kommando>`, etwa
  `node .claude/kit/worktree.mjs im <pfad> -- node tools/version.mjs --patch`.
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

Der Lauf misst mit `--in` im Worktree (Issue #1372):

```bash
node .claude/kit/checks.mjs run --in <pfad> --stufe push --wiederholen --since "$(git -C <pfad> merge-base HEAD origin/<mainBranch>)"
```

`<mainBranch>` ist der Wert aus der Config (Default: `main`).

**`--wiederholen`: eine rote Prüfung einmal auf demselben Stand** (Plan #1395, E2). Ist sie
bei der Wiederholung grün, gilt sie als bestanden und hat gewackelt; der Berichtsblock
trägt unter ihrer Zeile `gelaufen:` die Zeile `Gewackelt: <cmd> → erst rot, dann gruen`.
Bleibt sie rot, ist sie rot wie bisher.

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
  Check mit welchem Fehler fehlschlug. Der Lauf nennt dazu je roter Prüfung die
  **Verursacher-Karten** in einer eigenen Zeile (`Verursacher (<cmd>): …`) — die Karten,
  deren Commits seit dem Anker die Dateien dieser Prüfung berührt haben. Übernimm die
  Zeilen unverändert in den Bericht. Die Reparatur ist eine **neue Karte**: Die
  verursachende Karte wandert **nicht aus „In review" zurück** — sie ist abgeschlossen
  und wartet auf den Test des Menschen, und ein Rückzug verlöre genau diesen Stand.
  Genannt wird sie, damit die neue Karte weiß, wo sie ansetzt. Der Worktree wird trotzdem **abgebaut** (Schritt 8),
  und der Bericht sagt das: Der Bump ist seit Issue #656 idempotent, ein neuer Anlauf
  erzeugt ihn wieder — ein stehengebliebener Worktree wäre genau der Rest, den dieser Weg
  beseitigt.
- **Hinweise werden gezeigt, nicht gewertet.** Eine Hinweis-Prüfung endet grün und
  schreibt ihre Funde als `hinweis: <Datei und Grund>` in den Block `Fuer den
  Abschlussbericht:`. Die `hinweis:`-Zeilen gehen unverändert in den Bericht an den
  Menschen und halten weder Commit noch Push an — sie verlangen keine Freigabe
  (Issue #1156).
- Ist `buildChecks` leer: Hinweis „Keine buildChecks konfiguriert." und weiter zu
  Schritt 6 (kein Abbruch).

**Nach einem Wackler hält der Skill vor dem Commit an** (Plan #1395, E13). Unmittelbar
nach dem grünen Lauf, vor Schritt 6, liest er den Block `Fuer den Abschlussbericht:`
**dieses** Laufs. Auslöser ist allein eine Zeile `Gewackelt:` ohne den Zusatz
`(früherer Lauf vom …)` — sie steht für das Feld `gewackelt` an einem Eintrag in
`laufen[]` dieses Laufs. Nie ausgelöst wird der Halt durch `gewackeltKarte` oder eine
vorige Zusammenfassung. Dann, in dieser Reihenfolge:

1. Die gewackelten Prüfungen mit Namen nennen, die `Gewackelt:`-Zeilen unverändert.
2. Die Reparaturkandidaten holen und nennen (Plan #1395, E15):

   ```bash
   node .claude/kit/wirksamkeit.mjs kandidaten
   ```

   Es liest `.claude/wirksamkeit.json` der Hauptkopie und gibt je Kandidat eine Zeile
   `Reparaturkandidat: <cmd> — <n> Wackler im Zeitfenster` aus; leere Ausgabe heißt kein
   Kandidat.
3. Wörtlich fragen: „Trotzdem fortfahren? (ja/nein)“ Nur `ja` fährt fort mit Schritt 6.
   Alles andere endet wie ein roter Lauf: kein Commit, kein Push, weiter mit Schritt 8,
   der Worktree wird abgebaut.

`checks.mjs run` endet in diesem Fall mit Exitcode 0 — die Prüfung ist bestanden, die
Entscheidung liegt beim Menschen. **Ohne Wackler** ruft der Skill `wirksamkeit.mjs
kandidaten` ebenfalls, an derselben Stelle: Reparaturkandidaten ohne Wackler werden genannt,
halten aber nicht an.

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
node .claude/kit/worktree.mjs im <pfad> -- node .claude/kit/befunde.mjs buchen --datei <tmpdir>/<id>-buchung.md --stufe code --karte <id>
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

**Im Worktree** — jedes git-Kommando mit `-C <pfad>`, siehe Schritt 3.

```bash
git -C <pfad> add <die Dateien aus Schritt 4>
git -C <pfad> commit -m "<Betreff nach der Regel unten>"
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

**Vor-Push-Schritt.** Nennt `RELEASING.md` einen Vor-Push-Schritt, fährt der Skill ihn
nach dem Commit (Schritt 6) und vor dem Push, im Worktree über
`node .claude/kit/worktree.mjs im <pfad> -- <kommando>`, **im Hintergrund**, und wartet
auf dessen Ende — er kann länger laufen, als ein Werkzeugaufruf im Vordergrund darf, und
endet nach seiner eigenen Frist von selbst. Seine Fortschrittszeilen und seine Schlusszeile
zeigt der Skill, bevor er pusht. Er ist kein eigener Schritt: Die Zählung bleibt `von 9`.
Nennt `RELEASING.md` keinen, oder gibt es keine `RELEASING.md`, entfällt er ersatzlos.

- Exit 0 — weiter zum Push.
- Exit 1 — die Prüfung ist rot. Der Skill zeigt das Ergebnis und fragt wörtlich:
  „Vor-Push-Prüfung rot. Trotzdem pushen? (ja/nein)“ Nur `ja` pusht;
  alles außer „ja“ heißt kein Push, weiter mit Schritt 8.
- Jeder andere Exit — Halt ohne Push, mit der Meldung des Werkzeugs; weiter mit Schritt 8.

Aus dem Worktree, der auf einem losgelösten `HEAD` steht:

```bash
git -C <pfad> push origin HEAD:<mainBranch>
```

**Kein `--force`, auch nicht nach dem Rebase.** Der Push ist nach Schritt 3 ein
Fast-Forward; wird er abgewiesen, ist `origin` zwischenzeitlich weitergelaufen — dann endet
der Lauf mit dieser Meldung, und der Mensch entscheidet.

Nach dem Push auf `<mainBranch>` — auch auf dem Weg über den Build-Dienst — verwirft der
Skill eine übernommene Vorbereitung mit `vorbereitung-pruefen --verwerfen`, wie in
Schritt 3 beschrieben. Ohne Push bleibt sie für den nächsten Anlauf liegen.

### 8. Rückweg, Nachziehen, Worktree abbauen

> `Schritt 8 von 9 — Rueckweg und Abbau (laeuft)`

Die drei Schritte laufen **immer**, auch nach einem roten Prüflauf, einem Rebase-Konflikt,
einem Halt im Vor-Push-Schritt oder einem abgewiesenen Push — ein liegengebliebener Worktree ist genau der Rest, den
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

**Wackler und Reparaturkandidaten.** Der Bericht nennt jede `Gewackelt:`-Zeile des
Prüflaufs unverändert samt der Antwort des Menschen auf die Rückfrage und jede Zeile
`Reparaturkandidat:` aus `wirksamkeit.mjs kandidaten` (Schritt 5). Ohne beides entfällt
der Absatz.

**In den Bericht gehören außerdem:** der Pfad des Worktrees und sein Abbau, ob das lokale
`<mainBranch>` nachgezogen wurde oder mit welchem Grund nicht, und dass der
Haupt-Working-Tree unberührt geblieben ist.

**CI-Hinweis, abhängig vom `codeHost`.** Bei `github` und `gitlab` gehört in den Abschlussbericht: „Falls der Push einen CI-Lauf auslöst, wird er hier nicht gegatet; `merge production` prüft den Commit." Einzige Ausnahme ist die Vor-Push-Prüfung aus Schritt 7, wenn `RELEASING.md` eine nennt: Ihr Ergebnis lag vor dem Push vor, und der Bericht nennt es. Bei `local` entfällt der Hinweis ersatzlos. Der Zustand der CI wird hier **nicht abgefragt** — der Lauf zum eben gepushten Commit ist Sekunden später nie fertig, ein Gate müsste warten, und `push main` ist der häufige Trigger. Geprüft wird die CI am Release, in `/merge-production` (Issue #316).

Hinweis auf nächsten Schritt:
> "Commit-Batch gepusht. Wenn der Test-Server automatisch zieht: dort prüfen. Dann auf Wunsch \`merge production\` für den PR nach production."

## Weg über den Build-Dienst (`pushPruefung`)

Gilt nur, wenn `checks.mjs plan --stufe push` in Schritt 1 `pushPruefung` als Objekt mit
`"ort": "buildDienst"` meldet (Issue #1216, Plan #1199 E14). Der volle Lauf findet dann im
Build-Dienst des Projekts statt statt auf diesem Rechner. **Die Pflicht ist dieselbe:**
Grün vor dem Push auf `<mainBranch>`, ein Rot hält an, `productionBranch` bleibt
unberührt. `<zweig>` ist der Wert aus `pushPruefung.zweig`. Schritte, Zählung `von 9` und
Fortschrittszeilen bleiben; anders sind nur Schritt 5 und Schritt 7.

**Was der Build-Dienst fahren muss.** Ein Push auf `<zweig>` startet dort den Lauf der
Stufe `push` über den Batch:

```bash
node .claude/kit/checks.mjs run --stufe push --since "$(git merge-base HEAD origin/<mainBranch>)"
```

Diesen Job richtet das Projekt in seinem Build-Dienst ein — dieser Skill legt ihn nicht an.
Weil der Lauf dort `checks.mjs` fährt, steht im Build-Log bei Rot dieselbe Zeile
`Verursacher (<cmd>): …` wie beim lokalen Lauf.

**Schritt 5 auf diesem Weg — Nachweis für den Commit.** Der volle Lauf fällt hier weg. Das
Commit-Gate verlangt für die Release-Dateien aus Schritt 4 trotzdem einen grünen Lauf, der
sie gesehen hat. Ihn liefert ein Lauf der Paketstufe über genau diese Dateien, im Worktree:

```bash
node .claude/kit/checks.mjs run --in <pfad> --since HEAD --wiederholen
```

Mit `--wiederholen` wie in Schritt 5 (Plan #1395, E3), und ein Wackler hält vor dem Commit
an wie dort. Der Job des Build-Dienstes oben bleibt ohne den Schalter (E18).

Rot hält an wie in Schritt 5: kein Commit, kein Push, weiter mit Schritt 8. Hat Schritt 4
nichts erzeugt, meldet er `leeresPaket`, und Schritt 6 entfällt wie beschrieben.

**Schritt 7 auf diesem Weg — Push über den Prüfzweig.** Der Vor-Push-Schritt aus
`RELEASING.md` läuft wie beschrieben davor. Dann, aus dem Worktree:

1. Den Stand auf den Prüfzweig pushen:

   ```bash
   git -C <pfad> push origin HEAD:<zweig>
   ```

   Wird er abgewiesen, liegt auf `<zweig>` noch ein fremder Stand — der Lauf endet mit
   dieser Meldung, weiter mit Schritt 8. Kein `--force`.
2. Warten, bis der Build-Dienst fertig ist. `<sha>` ist die Ausgabe von `git -C <pfad> rev-parse HEAD`:

   ```bash
   node .claude/kit/board.mjs code ci-status --commit <sha>
   ```

   Der Aufruf wird alle 30 Sekunden wiederholt, solange `status` `laeuft` meldet, mit
   einer **Frist von 60 Minuten**. Unmittelbar nach dem Push meldet er `laeuft`, weil der
   Lauf noch nicht sichtbar ist — das ist kein Fehler. Läuft die Frist ab, ist das ein
   Fehlschlag: kein Push auf `<mainBranch>`, weiter mit Schritt 8. Ein Fehlschlag des
   Aufrufs selbst (Netz, Anmeldung) zählt genauso.
3. `<mainBranch>` nur bei `gruen` pushen — mit demselben Kommando wie in Schritt 7:

   ```bash
   git -C <pfad> push origin HEAD:<mainBranch>
   ```

   Für ihn gilt der Absatz zu `--force` und zum abgewiesenen Push aus Schritt 7.

**Bei `rot` hält der Skill an wie bei einem roten Lauf in Schritt 5:** kein Push auf
`<mainBranch>`, Meldung, welcher Job rot ist (die Liste `jobs` des Aufrufs), und die
**Adresse des Build-Logs** zum Commit `<sha>` — dort stehen die rote Prüfung und die Zeile
`Verursacher (<cmd>): …`. Bei `codeHost` `github` ist das
`https://github.com/<repo>/commit/<sha>/checks`, bei `gitlab` die Pipeline-Seite des
Projekts zum Commit (`<projekt-url>/-/pipelines?sha=<sha>`); `<repo>` nennt
`node .claude/kit/board.mjs code repo-name`. Die Reparatur ist eine neue Karte, wie in
Schritt 5.

**Meldet der Aufruf `keine`**, hat das Projekt keinen Build-Dienst (`codeHost` `local`).
Das ist ein Widerspruch in der Config: kein Push auf `<mainBranch>`, Meldung mit diesem
Grund, weiter mit Schritt 8.

**Schritt 8 auf diesem Weg** löscht zusätzlich den Prüfzweig, sobald er gepusht wurde — vor
dem Rückweg, auch nach Rot, Fristablauf oder abgewiesenem Push:

```bash
git -C <pfad> push origin --delete <zweig>
```

So beginnt der nächste Lauf auf einem leeren Prüfzweig und braucht nie `--force`. Scheitert
das Löschen, steht es in einer Zeile im Bericht und hält den Abbau nicht auf.

**Schritt 9 auf diesem Weg** nennt in der Nachweiszeile statt der lokalen Prüfungen den
Build-Dienst: `<hash> — gedeckt von: Build-Dienst, Prüfzweig <zweig> (gruen, <Zeitpunkt>)`.
Der CI-Hinweis entfällt — die CI hat vor dem Push gegatet.

## Modus `vorbereiten` (unbeaufsichtigt)

`/push-main vorbereiten` startet der Nacht-Runner am Ende eines Laufs, wenn eine Kette das
Ziel „Veröffentlichung vorbereitet" erreicht hat (Plan #1243, A5). Die Session läuft in der
Hauptkopie, während der Runner die Umsetzungssperre hält: Nichts baut mehr. Sie fährt alles,
was vor dem Veröffentlichen ohne Menschen und ohne Push geht, und hält das Ergebnis fest.
Morgens übernimmt `push main` den Stand, wenn er sich nicht geändert hat (Schritt 3).

**Schritte 1 bis 6** wie oben, mit diesen Abweichungen:

- **Schritt 3:** Der Fetch in der Hauptkopie (`git fetch origin <mainBranch>`) ist erlaubt,
  weil der Runner die Umsetzungssperre hält — kein Bau verliert dabei den Boden.
  `vorbereitung-pruefen` entfällt. Der Worktree entsteht mit eigenem Präfix:

  ```bash
  node .claude/kit/worktree.mjs anlegen --praefix vorbereitung --ref <mainBranch>
  ```

  Danach `git -C <pfad> rebase origin/<mainBranch>` wie oben. **Scheitert der
  Fetch**, ist das kein Abbruch: Gerebased wird auf die vorhandene Referenz
  `origin/<mainBranch>`, der Lauf geht weiter und übergibt beim Festhalten
  `--fetch fehlgeschlagen`. Ein Rebase-Konflikt endet wie oben ohne Festhalten; der Runner
  liest dann keine Vorbereitung dieses Laufs.
- **Schritt 4:** Ohne `RELEASING.md` entfällt er wie oben (E15).
- **Schritt 5:** der volle Prüflauf der Push-Stufe. Auf dem Weg über den Build-Dienst ist
  Schritt 5 der Nachweislauf der Paketstufe aus dem Abschnitt „Weg über den Build-Dienst"
  (`checks.mjs run --in <pfad> --since HEAD --wiederholen`), danach der Commit (E17). Der volle Lauf im Build-Dienst
  bleibt offen und läuft morgens in Schritt 7. Ein Wackler hält nachts nicht an und wird
  nicht erfragt: `vorbereitung-festhalten` macht aus ihm selbst einen offenen Punkt
  `Gewackelt: <cmd> — Entscheidung beim push main` (Plan #1395, E14).
- **Schritt 6:** der Commit `chore: vX.Y.Z` im Worktree, wie oben.

**Statt Schritt 7** hält die Session das Ergebnis fest, auch nach einem roten Prüflauf:

```bash
node .claude/kit/worktree.mjs vorbereitung-festhalten <pfad> --ergebnis <gruen|gruen-offen|rot>
```

- Nach einem gescheiterten Fetch zusätzlich `--fetch fehlgeschlagen`.
- Der Vor-Push-Schritt aus `RELEASING.md` und eine UI-Prüfung, die nach `/local-check`,
  Schritt 3, nötig ist, gehen je als `--offen "<Text>"` mit. **Gestartet werden sie nicht**
  (E9): Ob ein Vor-Push-Schritt pusht, ist nachts nicht prüfbar. Mit einem offenen Punkt
  heißt das Ergebnis `gruen-offen`.
- Den Build-Dienst-Punkt setzt das Kommando selbst — die Session übergibt ihn nicht.

**Danach Schritt 8 ohne Nachziehen:** `rueckweg` und `entfernen` wie oben,
`nachziehen-pruefen` und das Rebase des lokalen `<mainBranch>` entfallen. Schritt 9 meldet
das Ergebnis von `vorbereitung-festhalten`.

**Kein Push** — weder auf `<mainBranch>`, noch auf den Prüfzweig, noch auf einen
Vorab-Zweig: kein Prüfzweig, kein Vorab-Zweig, kein Tag. Der Modus endet beim lokalen
Commit im Worktree; was nur mit einem Push ginge, ist offen.

## Was dieser Skill nicht tut

- Kein Commit und kein Push bei einem roten Prüflauf (Schritt 5)
- Kein Erzeugen, Prüfen oder Committen im Haupt-Working-Tree — das läuft ausschließlich im
  Worktree aus Schritt 3
- Kein zurückgelassener Worktree, auch nicht nach einem roten Lauf (Schritt 8)
- Kein Rebase des lokalen `<mainBranch>`, während eine Sperre des Nacht-Runners liegt oder
  der Haupt-Tree schmutzig ist (Schritt 8)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- Keine Force-Pushes
- Kein Push auf `production` oder andere Branches — ausgenommen der Vorab-Zweig, den ein Vor-Push-Schritt selbst anlegt und löscht
- Kein Push auf den Prüfzweig außerhalb des Wegs über den Build-Dienst, und auf ihm kein
  Push auf `<mainBranch>` ohne grünes Ergebnis des Build-Dienstes
- Kein Push ohne vorherige Bestätigung durch den Menschen (Trigger-Phrase)
- Kein Push im Modus `vorbereiten`, auch nicht auf den Prüfzweig oder einen Vorab-Zweig
- Kein automatischer Push nach Commit, nach grünem Check oder nach Review
- Kein Halt wegen des Aufwands-, des Wirksamkeits- oder des Befunds zu den
  Modell-Prüfungen: Alle drei sind **kein Gate**, weder ihr Inhalt noch ihr Fehlschlag
  hält das Veröffentlichen auf. Sie sagen, was auffällt — was daraus folgt, entscheidet
  der Mensch.
- Kein Halt wegen der Buchung der Code-Review-Befunde: Auch sie ist kein Gate, und sie
  bucht nichts ohne Übernahmevermerk — entschieden hat der Mensch, bevor eingearbeitet
  wurde.
