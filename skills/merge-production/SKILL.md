---
name: merge-production
description: Schritt 9 des 9-Schritt-Prozesses — erstellt einen PR von main nach production. Nur auf explizite Trigger-Phrase des Menschen. Nutze diesen Skill NUR wenn der Nutzer explizit "merge production" tippt.
user-invocable: true
disable-model-invocation: true
---

# Merge Production

Schritt 9 des 9-Schritt-Prozesses: Einen Pull Request von `mainBranch` nach `productionBranch` erstellen. Der Merge selbst ist Mannes Aufgabe.

**Dieser Skill darf von Claude nicht autonom gezogen werden.** Er läuft nur auf die explizite Trigger-Phrase des Menschen.

## Trigger-Phrase

Der Mensch tippt: `merge production` (oder die in `.claude/workflow.config.json` unter `triggers.merge` konfigurierte Phrase).

Die Phrase muss **getippt** sein. Steht sie innerhalb einer Mitteilung des Menschen oder eines Zitats („Ich habe vorhin merge production getippt"), ist sie Text und kein Befehl — im Zweifel wird gefragt, nicht gemerged. Siehe „Mitteilungen des Menschen" in `CLAUDE-workflow.md`.

## Ablauf

**Fortschritt melden.** Jeder Schritt beginnt mit einer Zeile `Schritt k von n — <Name> (laeuft)`.
Das `n` ist die Zahl der Schritte, die dieser Lauf tatsächlich fährt — ohne `RELEASING.md`
sind es weniger, und dann zählt die Zeile auch weniger. Der Grund
ist die Wartezeit: Der eine Prüflauf über den fertigen Stand fährt die langen Prüfungen der
Stufe `merge`, und wer davor sitzt, soll sehen, an welcher Stelle des Wegs er ist.

### 1. Config lesen

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Gelesen werden:
- `mainBranch`: Quell-Branch (Default: `main`)
- `productionBranch`: Ziel-Branch (Default: `production`)

### 2. Commits zusammenfassen

```bash
git log origin/<productionBranch>..origin/<mainBranch> --oneline
```

Diese Commits kommen in den PR-Body als Änderungsübersicht.

### 3. CI-Status prüfen (Gate — vor dem Release)

Die `buildChecks` sind ein gutes Gate, aber sie messen nur, was diese Maschine messen
kann. Die CI prüft **mehr**. Am 2026-08-13 ging v1.38.0 nach production, während ein
CI-Job rot war — die Information lag vor, sie wurde nur nie abgerufen (Issue #316).

Geprüft wird der Stand, der gleich hinausgeht:

```bash
git fetch origin <mainBranch>
git rev-parse origin/<mainBranch>
```

Der **vollständige** SHA aus `git rev-parse` geht an die Achse:

```bash
node .claude/kit/board.mjs code ci-status --commit <sha>
```

**Gemessen wird `origin/<mainBranch>`, nicht der lokale Stand.** Bis Issue #929 stoppte der
Skill, wenn `git rev-parse HEAD` davon abwich. Die Regel ist entfallen, weil der Release
seit #929 in einem eigenen Worktree auf `origin/<mainBranch>` entsteht: Der Haupt-Tree wird
gar nicht mehr gemessen, und ein lokaler, noch nicht gepushter Commit geht darum auch nicht
mit hinaus. Die CI urteilt weiter über genau den Stand, der veröffentlicht wird.

Das Ergebnis entscheidet:

- **`rot`: kein PR.** Der Skill nennt die roten Jobs mit Namen und endet. Dieselbe Härte wie beim buildChecks-Gate — ein Release ist der teuerste Zeitpunkt für eine Warnung, die man überliest. **Exit-Code 1 der Achse wird wie `rot` behandelt**, denn ein Adapterfehler darf kein Freifahrtschein sein.
- **`laeuft`:** Der Skill nennt die laufenden Jobs und fragt genau einmal: `CI läuft noch. PR trotzdem erstellen? (ja/nein)`. Nur die Antwort `ja` fährt fort; jede andere Antwort endet ohne PR. Nachts gibt es keinen `merge production`-Trigger, die Rückfrage ist hier also unproblematisch.
- **`keine`:** Der Lauf fährt unverändert weiter — ein Projekt ohne CI ist nicht releaseunfähig.

**Warum das Gate hier steht und nicht nach dem Release-Push:** Der Lauf zum eben
gepushten `chore: vX.Y.Z` ist Sekunden später nie fertig — das Gate lieferte dann im
Regelfall `laeuft` und fragte jedes Mal. Und ein Stopp bei `rot` ließe den Versionsbump
auf `origin/<mainBranch>` zurück, während das Bump-Kommando nicht idempotent ist und der
nächste Anlauf erneut bumpte. Der Stand von `push main` trägt zudem die eigentliche
Änderung; der Release-Commit nur Stempel und Changelog.

**Vorab-Halt: erst `push main` (Issue #1000).** Es gibt nie ein `merge production` ohne
vorheriges `push main`. Bevor der Worktree entsteht, prüft der Skill, ob das lokale
`<mainBranch>` Commits trägt, die nicht auf `origin/<mainBranch>` liegen:

```bash
git log origin/<mainBranch>..<mainBranch> --oneline
```

Ist die Ausgabe nicht leer, endet der Skill hier — kein Worktree, kein Prüflauf, kein PR —
mit der Meldung:

> Erst `push main` — dieser Stand ist noch nicht veröffentlicht und nicht geprüft.

Der Halt ist die Voraussetzung für den verkürzten Prüflauf in Schritt 6: Weil der Stand bis
`origin/<mainBranch>` beim `push main` vollständig geprüft wurde, prüft die Freigabe nur
noch, was dort nicht geprüft wurde. Nachgewiesen wird das am Git-Stand, nicht an einer
zweiten Buchführung.

### 4. Worktree auf `origin/<mainBranch>` anlegen

> `Schritt 4 von 12 — Worktree (laeuft)`

**Alles, was dieser Lauf erzeugt, prüft, committet und pusht, entsteht in einem eigenen
Worktree — nicht im Haupt-Working-Tree.** Dort kann gleichzeitig die Umsetzungsstufe des
Nacht-Runners bauen (Variante B). Am 2026-09-25 riss genau das in kanban-kit zweimal
dieselbe Kette ab: Der Runner fand die Release-Dateien als unkommittierte Reste und stoppte
hart. Dazu kommt, dass fremde, halbfertige Dateien im Haupt-Tree — etwa ein noch roter
TDD-Test — den Release-Prüflauf verfälschen würden.

```bash
node .claude/kit/worktree.mjs anlegen --praefix release --ref origin/<mainBranch>
```

**Der Ref ist `origin/<mainBranch>`, nicht das lokale `HEAD`:** Veröffentlicht wird, was
gepusht ist. Ein lokaler Commit, den niemand gepusht hat, darf nicht über den Release-Push
mit hinausgehen. Deshalb entfällt in Schritt 3 auch die alte Stopp-Regel — es gibt nichts
mehr abzugleichen. Kein Rebase: Der Worktree steht schon auf dem veröffentlichten Stand.

Das Kommando räumt liegengebliebene Release-Worktrees ab, spiegelt `.claude/` hinein
(Kit-Kopie, Config, Token) und gibt den Pfad als JSON aus. Die Worktrees der Nacht
(`kette`, `pruefung`) bleiben unberührt.

**Alle Kommandos der Schritte 5 bis 9 laufen in diesem Worktree — ohne `cd`.** Claude Code
setzt das Arbeitsverzeichnis außerhalb der erlaubten Verzeichnisse nach jedem Aufruf zurück,
und ein zusammengesetzter Aufruf mit vorangestelltem `cd` fällt nicht mehr unter
`sandbox.excludedCommands` — der Prüflauf liefe in der Sandbox (Issue #1372). Darum nennt
jeder Aufruf den Worktree selbst und steht allein: git als `git -C <pfad> …`, der Prüflauf
als `checks.mjs run --in <pfad> …`, jedes andere Kommando, etwa aus
`RELEASING.md`, als `node .claude/kit/worktree.mjs im <pfad> -- <kommando> [argumente]`.
Ein Commit im falschen Baum ist genau der Fehler, den dieser Schritt beseitigt; mit `-C`
und `--in` steht der Baum in jedem Aufruf.

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
**ohne Commit, ohne Push und ohne PR** mit diesem Grund: Ein Check, der an fehlenden
Abhängigkeiten scheitert, wird nie als grüner Lauf gemeldet und nie ausgelassen.

### 5. Release-Dateien erzeugen (falls `RELEASING.md` existiert)

> `Schritt 5 von 12 — Release-Dateien erzeugen (laeuft)`

Prüfe, ob im Repo-Root eine `RELEASING.md` liegt.
- **Ja:** Führe die dort unter dem Merge-Trigger (`merge production`) beschriebenen
  Schritte aus — **bis zum ersten festschreibenden Schritt**, also typischerweise Bump,
  Stempel und Changelog. Nicht committen: Das kommt aus Schritt 7. Jeder Schritt läuft im
  Worktree über `node .claude/kit/worktree.mjs im <pfad> -- <kommando>`.
- **Nein:** Nichts weiter tun — direkt weiter zu Schritt 6.

**Fremde `RELEASING.md`.** Die Grenze ist der erste Schritt, der festschreibt oder
veröffentlicht (`git commit`, `git push`, `git tag`, ein Release-Kommando). Alles davor
fährt der Skill; ab dort übernimmt er. Stehen **hinter** dem ersten festschreibenden
Schritt noch weitere Schritte, führt der Skill sie nach seinem Commit aus und sagt das im
Abschlussbericht.

Der Skill selbst kennt keine projektspezifische Versions- oder Changelog-Logik; diese
lebt ausschließlich in der `RELEASING.md` des jeweiligen Repos. Ein Tag entsteht hier
**nicht** — siehe Schritt 9.

### 6. Der eine Prüflauf (Gate — vor Commit, Push und PR)

> `Schritt 6 von 12 — Prueflauf (laeuft)`

**Vor dem einen Commit dieses Wegs steht der eine Prüflauf.** Der Nachweis gehört zum
Commit: Bump, Stempel und Changelog erzeugen Dateien, die kein früherer Lauf gesehen haben
kann, und ohne Nachweis für genau diesen Stand weist das Commit-Gate sie ab. Bis v1.53
stand vor **jedem** Commit dieses Wegs ein eigener Lauf — es gab zwei. Jetzt gibt es einen
Commit und darum einen Lauf.

Der Lauf misst mit `--in` im Worktree (Issue #1372):

```bash
node .claude/kit/checks.mjs run --in <pfad> --stufe merge --since "$(git -C <pfad> merge-base HEAD origin/<mainBranch>)"
```

**Dieser Skill fährt die Freigabestufe, und sie prüft nur, was `push main` nicht geprüft
hat** (Issue #1000). Der Stand bis zum Anker ist beim unmittelbar vorangehenden `push main`
vollständig geprüft worden — dafür steht der Vorab-Halt vor Schritt 4. Neu sind nur die
Release-Dateien aus Schritt 5 (Bump, Stempel, Changelog). Darum laufen:

- die Prüfungen mit `stufe: "merge"` — immer, sie laufen nur hier;
- die Prüfungen der Paketstufe **nach Bereichen über die Dateien seit dem Anker**, wie beim
  Abschluss einer Karte: Eine Datei ohne Bereich fährt jede Prüfung der Paketstufe;
- die Prüfungen mit `stufe: "push"` **nicht** — sie stehen unter `ausgelassen` mit dem Grund
  `Stufe push, geprueft beim push main`.

Keine Pflichtprüfung entfällt dadurch aus dem Gesamtprozess: Jede läuft einmal vor der
Freigabe, Paket- und Push-Stufe beim `push main`, die Merge-Stufe hier.

**Der Anker ist der Batch, nicht `HEAD`.** Ohne `--since` nimmt `planen` in
`kit/checks.mjs` `HEAD` als Basis; ist seit `HEAD` nichts geändert, liefen nur noch die
Merge-Prüfungen, und die Release-Dateien bekämen keine Paketprüfung.

Ein roter Lauf hält an: kein Commit, kein Push, kein PR. Der Bump aus Schritt 5 bleibt im
Worktree stehen, und der Worktree wird trotzdem **abgebaut** (Schritt 8) — der Bump ist seit
Issue #656 idempotent, ein neuer Anlauf erzeugt ihn wieder.

### 7. Der eine Commit

> `Schritt 7 von 12 — Commit (laeuft)`

**Im Worktree** — jedes git-Kommando mit `-C <pfad>`, siehe Schritt 4.

```bash
git -C <pfad> add <die Dateien aus Schritt 5>
git -C <pfad> commit -m "chore: vX.Y.Z"
```

Der Commit geht auf den Stand von `origin/<mainBranch>`, damit die Dateien im PR nach
`production` enthalten sind, und entsteht nur bei tatsächlichem staged Diff. Hat Schritt 5
nichts erzeugt, gibt es keinen Release-Commit — das gehört in den Abschlussbericht und
bedeutet, dass Schritt 9 nichts zu taggen hat.

**Merke dir den Hash dieses Commits.** Schritt 9 braucht ihn, und er ist danach nicht mehr
sicher rekonstruierbar — vor allem nicht nach dem Abbau des Worktrees:

```bash
git -C <pfad> rev-parse --short HEAD
```

**Die Nachweiszeile.** Nenne im Abschlussbericht zu diesem Commit den Hash, das Ergebnis
des deckenden Laufs aus Schritt 6 und dessen `zeitpunkt` aus der Prüf-Zusammenfassung
(`.claude/checks-summary.json`, Issue #655) — der Zeitpunkt sagt, ob der Nachweis zu
diesem Stand gehört oder von einem früheren Lauf stammt. Gelesen wird die Zusammenfassung
des **Worktrees**; dort lief die Prüfung.

Danach pushen — der Worktree steht auf einem losgelösten `HEAD`:

```bash
git -C <pfad> push origin HEAD:<mainBranch>
```

**Kein `--force`.** Der Worktree setzte auf `origin/<mainBranch>` auf, der Push ist damit
ein Fast-Forward. Wird er abgewiesen, ist `origin` zwischenzeitlich weitergelaufen — dann
endet der Lauf ohne PR mit dieser Meldung, und der Mensch entscheidet.

### 8. Rückweg, Nachziehen, Worktree abbauen

> `Schritt 8 von 12 — Rueckweg und Abbau (laeuft)`

Die drei Schritte laufen **immer**, auch nach einem roten Prüflauf oder einem abgewiesenen
Push — ein liegengebliebener Worktree ist genau der Rest, den dieser Weg beseitigt.

```bash
node .claude/kit/worktree.mjs rueckweg <pfad>
node .claude/kit/worktree.mjs nachziehen-pruefen
node .claude/kit/worktree.mjs entfernen <pfad>
```

`rueckweg` ersetzt `.claude/checks-summary.json` der Hauptkopie durch die des Worktrees (sie
bezeugt den frisch gemessenen Stand) und hängt Ausführungsprotokoll
(`.claude/ausfuehrungen.tsv`) und Befunde (`.claude/befunde.tsv`) an.

`nachziehen-pruefen` entscheidet über das lokale `<mainBranch>`, das nach dem Push aus dem
Worktree hinter `origin` zurückliegt:

- **`nachziehen: true`** — in der Hauptkopie `git fetch origin <mainBranch>` und
  `git rebase origin/<mainBranch>`.
- **`nachziehen: false`** — **nicht** nachziehen. Der Skill nennt den `grund` und gibt die
  beiden Kommandos als kopierbare Zeile aus. Ein Rebase unter einer laufenden Umsetzung
  verschöbe ihr den Boden, und in einem schmutzigen Baum hielte er ohnehin an.

Der Pfad des Worktrees, sein Abbau und der Ausgang des Nachziehens gehören in den
Abschlussbericht — ebenso, dass der Haupt-Working-Tree unberührt geblieben ist.

### 9. Tag-Kommando ausgeben — der Tag wird nicht gesetzt

> `Schritt 9 von 12 — Tag-Kommando (laeuft)`

**Der Skill setzt und pusht keinen Tag.** Ein Tag markiert ein Release, und
Releases setzt der Mensch — dieselbe Linie wie bei den drei Stop-Punkten.

Was der Skill liefert, ist die **fertige, kopierbare Kommandozeile**, in einem
eigenen Code-Block am Ende des Laufs:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

`<hash>` ist der `chore: vX.Y.Z`-Commit aus Schritt 7 — der Skill kennt ihn, weil
er ihn selbst erzeugt hat. **Nicht `HEAD` einsetzen und nicht raten:** Nach dem
Release-Commit können weitere Commits folgen, und der Tag zeigt dann auf den
falschen Stand.

Der Tag zeigt auf den Release-Commit auf `mainBranch` — nicht auf den
Merge-Commit in `productionBranch`.

Der Grund für die Kommandozeile statt einer Bitte: Wer nach jedem Release Hash
und Syntax selbst zusammensuchen muss, lässt es irgendwann bleiben. Genau das ist
sechsmal in Folge passiert (Issue #244).

Hat Schritt 7 keinen Release-Commit erzeugt — keine `RELEASING.md`, kein Bump —,
gibt es nichts zu taggen. Das gehört **in den Abschlussbericht**, nicht in ein
stilles Überspringen.

**Beim `push main`-Trigger entsteht kein Tag.** Dort entstehen interne
Patch-Stände, die niemand veröffentlicht; ein Tag je Patch wäre Lärm.

### 10. PR bzw. MR erstellen

> `Schritt 10 von 12 — PR erstellen (laeuft)`

```bash
node .claude/kit/board.mjs code pr \
  --from <mainBranch> \
  --to <productionBranch> \
  --title "Release: <mainBranch> -> <productionBranch> (<DATUM>)"
```

Der Adapter erstellt den PR/MR provider-unabhaengig. Bei `codeHost: local` gibt er einen gefuehrten Merge-Dialog aus.

### 11. GitHub-Release-Kommando ausgeben — erst nach dem Tag ausführbar

Am Ende dieses Laufs existiert der Tag **noch nicht**: Schritt 9 hat nur die
Kommandozeile ausgegeben, gesetzt hat ihn niemand. Ein Release kann in diesem
Lauf deshalb nicht entstehen — das ist keine Ausnahme, sondern der Normalfall.

Bei `codeHost: github` gibt der Skill das zweite Kommando gleich mit aus, im
selben Block wie das Tag-Kommando, damit beides in einem Rutsch ausführbar ist:

```
gh release create vX.Y.Z --title vX.Y.Z --notes-file <pfad-zum-changelog-abschnitt>
```

Der Notes-Body ist der neue Abschnitt aus `CHANGELOG.md` (falls die
`RELEASING.md`-Schritte einen erzeugt haben); ohne Changelog-Datei die
Commit-Liste aus Schritt 2 als Notes.

Bei `codeHost` ungleich `github` (z. B. `gitlab`, `local`) entfällt das
Release-Kommando. Das gehört **in den Abschlussbericht** — dass ein Schritt nicht
greift, muss man lesen können, sonst sieht ein Lauf ohne Release aus wie ein Lauf
mit Release.

### 12. PR/MR-URL und die beiden Kommandos zurückgeben

Gib die URL aus dem Adapter-Output aus, gefolgt von den Kommandos aus Schritt 9
und 11 in **einem** Code-Block. Der Merge ist Mannes Aufgabe — Claude merged nicht,
und den Tag setzt er ebenfalls selbst.

> "PR/MR erstellt: <URL>. Der Merge nach production liegt bei dir.
> Nach dem Merge der Tag:"
>
> ```
> git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
> gh release create vX.Y.Z --title vX.Y.Z --notes-file <pfad>
> ```

## Was dieser Skill nicht tut

- Kein direkter Push auf `production`
- Kein Merge des PR — das macht der Mensch
- Kein automatischer PR nach Push oder nach grünem Review
- Kein Force-Merge oder Bypass von Branch-Protection-Regeln
- **Kein PR bei roter CI** — und ein Exit-Code 1 der Achse `code ci-status` zählt
  wie `rot` (Schritt 3)
- **Kein Commit, kein Push und kein PR bei rotem Prüflauf** (Schritt 6)
- Kein Erzeugen, Prüfen oder Committen im Haupt-Working-Tree — das läuft ausschließlich im
  Worktree aus Schritt 4, und der setzt auf `origin/<mainBranch>` auf: Ein lokaler, nicht
  gepushter Commit geht mit diesem Release nicht hinaus
- **Kein Release über einen unveröffentlichten Stand** — trägt das lokale `<mainBranch>`
  Commits, die nicht auf `origin/<mainBranch>` liegen, endet der Skill vor dem Worktree
  (Vorab-Halt, Schritt 3)
- Kein zurückgelassener Worktree, auch nicht nach einem roten Lauf (Schritt 8)
- Kein Rebase des lokalen `<mainBranch>`, während eine Sperre des Nacht-Runners liegt oder
  der Haupt-Tree schmutzig ist (Schritt 8)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- **Kein Setzen und kein Pushen von Tags** — der Skill gibt nur die Kommandozeile
  aus, den Tag setzt der Mensch (Schritt 9)
- Kein Force-Push von Tags, kein Überschreiben bestehender Tags
