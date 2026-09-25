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
ist die Wartezeit: Der eine Prüflauf über den fertigen Stand dauert so lange wie der volle
`buildChecks`-Katalog, und wer davor sitzt, soll sehen, an welcher Stelle des Wegs er ist.

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
kann. Die CI prüft **mehr**: Dieses Repo fährt seit Issue #196 einen zweiten Job auf
`windows-latest`. Am 2026-08-13 ging v1.38.0 nach production, während genau dieser Job
fehlschlug — die Information lag vor, sie wurde nur nie abgerufen (Issue #316).

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
cd <pfad>
```

**Der Ref ist `origin/<mainBranch>`, nicht das lokale `HEAD`:** Veröffentlicht wird, was
gepusht ist. Ein lokaler Commit, den niemand gepusht hat, darf nicht über den Release-Push
mit hinausgehen. Deshalb entfällt in Schritt 3 auch die alte Stopp-Regel — es gibt nichts
mehr abzugleichen. Kein Rebase: Der Worktree steht schon auf dem veröffentlichten Stand.

Das Kommando räumt liegengebliebene Release-Worktrees ab, spiegelt `.claude/` hinein
(Kit-Kopie, Config, Token) und gibt den Pfad als JSON aus. Die Worktrees der Nacht
(`kette`, `pruefung`) bleiben unberührt.

**Alle Kommandos der Schritte 5 bis 7 laufen in diesem Worktree.** Der `cd`-Aufruf steht
deshalb als **eigenes** Kommando: Das Arbeitsverzeichnis bleibt für die folgenden Aufrufe
erhalten. Vor Schritt 7 wird das einmal mit `pwd` nachgesehen — ein Commit im falschen Baum
ist genau der Fehler, den dieser Schritt beseitigt.

**Abhängigkeiten im frischen Worktree.** Er trägt nur, was versioniert ist, plus das
gespiegelte `.claude/`. Braucht ein Pflichtcheck Abhängigkeiten **im Projektverzeichnis**
(`node_modules`, `.venv`, `vendor/`), fehlen sie dort und werden vor dem Prüflauf mit dem
Installationskommando des Projekts angelegt (`npm ci`, `uv sync`, …). **Nicht** aus der
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
  Stempel und Changelog. Nicht committen: Das kommt aus Schritt 7.
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

```bash
node .claude/kit/checks.mjs run --stufe merge --since "$(git merge-base HEAD origin/<mainBranch>)"
```

**Dieser Skill fährt die Freigabestufe.** Auf ihr laufen **alle drei Stufen** — Paket,
Push und Merge —, und zwar im vollen Umfang: auch dann, wenn seit dem letzten Push nichts
hinzugekommen ist. Das ist gewollt. Der Stand, der nach `production` geht, ist der Stand,
für den das Ergebnis gilt; eine bereichsbezogene Auswahl misst hier zu wenig.

**Der Anker ist der Batch, nicht `HEAD`.** Ohne `--since` nimmt `planen` in
`kit/checks.mjs` `HEAD` als Basis; ist seit `HEAD` nichts geändert, meldet es
`leeresPaket` und lässt **jede** Prüfung mit Exit 0 aus — ein Release liefe dann durch
eine leere Prüfung.

Ein roter Lauf hält an: kein Commit, kein Push, kein PR. Der Bump aus Schritt 5 bleibt im
Worktree stehen, und der Worktree wird trotzdem **abgebaut** (Schritt 8) — der Bump ist seit
Issue #656 idempotent, ein neuer Anlauf erzeugt ihn wieder.

### 7. Der eine Commit

> `Schritt 7 von 12 — Commit (laeuft)`

**Im Worktree** — einmal `pwd` davor, siehe Schritt 4.

```bash
git add <die Dateien aus Schritt 5>
git commit -m "chore: vX.Y.Z"
```

Der Commit geht auf den Stand von `origin/<mainBranch>`, damit die Dateien im PR nach
`production` enthalten sind, und entsteht nur bei tatsächlichem staged Diff. Hat Schritt 5
nichts erzeugt, gibt es keinen Release-Commit — das gehört in den Abschlussbericht und
bedeutet, dass Schritt 9 nichts zu taggen hat.

**Merke dir den Hash dieses Commits.** Schritt 9 braucht ihn, und er ist danach nicht mehr
sicher rekonstruierbar — vor allem nicht nach dem Abbau des Worktrees:

```bash
git rev-parse --short HEAD
```

**Die Nachweiszeile.** Nenne im Abschlussbericht zu diesem Commit den Hash, das Ergebnis
des deckenden Laufs aus Schritt 6 und dessen `zeitpunkt` aus der Prüf-Zusammenfassung
(`.claude/checks-summary.json`, Issue #655) — der Zeitpunkt sagt, ob der Nachweis zu
diesem Stand gehört oder von einem früheren Lauf stammt. Gelesen wird die Zusammenfassung
des **Worktrees**; dort lief die Prüfung.

Danach pushen — der Worktree steht auf einem losgelösten `HEAD`:

```bash
git push origin HEAD:<mainBranch>
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
- Kein zurückgelassener Worktree, auch nicht nach einem roten Lauf (Schritt 8)
- Kein Rebase des lokalen `<mainBranch>`, während eine Sperre des Nacht-Runners liegt oder
  der Haupt-Tree schmutzig ist (Schritt 8)
- Kein zweiter Commit und kein `--amend` auf diesem Weg
- **Kein Setzen und kein Pushen von Tags** — der Skill gibt nur die Kommandozeile
  aus, den Tag setzt der Mensch (Schritt 9)
- Kein Force-Push von Tags, kein Überschreiben bestehender Tags
